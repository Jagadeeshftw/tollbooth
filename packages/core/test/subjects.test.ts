import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mintNonce, mintSubject } from '../src/ids.js';
import { MemoryEntitlementStore } from '../src/memory.js';
import {
  DEFAULT_SUBJECT_TTL_MS,
  MIN_SUBJECT_TTL_MS,
  assertValidSubjectTtl,
  isSubjectLive,
  issueSubjectRecord,
  mayUseSubject,
  slideSubject,
} from '../src/subjects.js';

const DAY = 24 * 60 * 60 * 1000;

describe('handles are server-minted and unguessable', () => {
  it('mints distinct subjects with real entropy', () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintSubject()));
    assert.equal(seen.size, 500, 'no collisions');
    for (const s of seen) {
      assert.match(s, /^tb_s_[A-Za-z0-9_-]{20,}$/, 'prefixed, base64url, long enough');
    }
  });

  it('mints nonces separately from subjects', () => {
    const nonce = mintNonce();
    assert.ok(!nonce.startsWith('tb_s_'), 'a charge nonce is not a subject handle');
    assert.ok(nonce.length >= 20);
  });

  it('never derives a handle from anything the provider supplies', () => {
    // Guards the rule that a Moove link id is never used as a token: link ids
    // are readable by anyone holding them, via the public by-id route.
    const linkId = 'pl_9f2a41d0c7b84e15';
    for (let i = 0; i < 50; i++) {
      assert.ok(!mintSubject().includes(linkId));
      assert.ok(!mintNonce().includes(linkId));
    }
  });
});

describe('subject lifetime', () => {
  it('defaults to a 30 day sliding window', () => {
    assert.equal(DEFAULT_SUBJECT_TTL_MS, 30 * DAY);
    const r = issueSubjectRecord({ subject: 's', now: 1000 });
    assert.equal(r.expiresAt, 1000 + 30 * DAY);
  });

  it('slides forward on use, so an active caller never loses paid credits', () => {
    let r = issueSubjectRecord({ subject: 's', now: 0 });
    r = slideSubject(r, 20 * DAY);
    assert.equal(r.expiresAt, 20 * DAY + 30 * DAY);
    assert.equal(r.lastSeenAt, 20 * DAY);
    assert.equal(r.createdAt, 0, 'creation time is not rewritten');
  });

  it('expires a handle left unused past the window', () => {
    const r = issueSubjectRecord({ subject: 's', now: 0 });
    assert.equal(isSubjectLive(r, 30 * DAY - 1), true);
    assert.equal(isSubjectLive(r, 30 * DAY), false);
  });

  it('refuses a TTL short enough to strand paid credits', () => {
    assert.throws(() => assertValidSubjectTtl(60_000), /at least/);
    assert.throws(() => issueSubjectRecord({ subject: 's', now: 0, ttlMs: 1000 }), /strand credits/);
    assert.doesNotThrow(() => assertValidSubjectTtl(MIN_SUBJECT_TTL_MS));
  });

  it('accepts a configured window', () => {
    const r = issueSubjectRecord({ subject: 's', now: 0, ttlMs: 7 * DAY });
    assert.equal(r.expiresAt, 7 * DAY);
  });
});

describe('optional binding to a verified principal', () => {
  it('is unbound by default, because most transports supply no identity', () => {
    const r = issueSubjectRecord({ subject: 's', now: 0 });
    assert.equal(r.boundTo, null);
    assert.equal(mayUseSubject(r, 0, null), true);
    assert.equal(mayUseSubject(r, 0, 'anyone'), true);
  });

  it('refuses a bound handle presented by someone else', () => {
    const r = issueSubjectRecord({ subject: 's', now: 0, boundTo: 'user-123' });
    assert.equal(mayUseSubject(r, 0, 'user-123'), true);
    assert.equal(mayUseSubject(r, 0, 'user-456'), false, 'a leaked handle is worth less when bound');
    assert.equal(mayUseSubject(r, 0, null), false);
  });

  it('refuses an expired handle regardless of binding', () => {
    const r = issueSubjectRecord({ subject: 's', now: 0, ttlMs: MIN_SUBJECT_TTL_MS, boundTo: 'u' });
    assert.equal(mayUseSubject(r, MIN_SUBJECT_TTL_MS, 'u'), false);
  });
});

describe('subject persistence', () => {
  it('round-trips through the store and slides in place', async () => {
    const store = new MemoryEntitlementStore();
    const record = issueSubjectRecord({ subject: 'tb_s_x', now: 1000 });
    await store.putSubject(record);

    assert.equal((await store.getSubject('tb_s_x'))?.expiresAt, 1000 + 30 * DAY);

    await store.putSubject(slideSubject(record, 5 * DAY));
    const slid = await store.getSubject('tb_s_x');
    assert.equal(slid?.expiresAt, 5 * DAY + 30 * DAY);
    assert.equal(slid?.createdAt, 1000);
  });

  it('returns undefined for a handle it never issued', async () => {
    const store = new MemoryEntitlementStore();
    assert.equal(await store.getSubject('tb_s_forged'), undefined);
  });
});
