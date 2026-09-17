import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { issueSession, signSession, verifySession } from '../src/session.js';

const SECRET = 'test-session-secret';

describe('session sign and verify', () => {
  it('round-trips a payload', () => {
    const token = signSession({ tenantId: 'tb_t_1', issuedAt: 1000, expiresAt: 2000 }, SECRET);
    const verified = verifySession(token, SECRET, 1500);
    assert.deepEqual(verified, { tenantId: 'tb_t_1', issuedAt: 1000, expiresAt: 2000 });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession({ tenantId: 'tb_t_1', issuedAt: 0, expiresAt: 10_000 }, SECRET);
    assert.equal(verifySession(token, 'wrong-secret', 100), null);
  });

  it('rejects a tampered payload even with a valid-looking signature', () => {
    const token = signSession({ tenantId: 'tb_t_1', issuedAt: 0, expiresAt: 10_000 }, SECRET);
    const [body, mac] = token.split('.');
    const forged = { tenantId: 'tb_t_someone_else', issuedAt: 0, expiresAt: 10_000 };
    const forgedBody = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    assert.equal(verifySession(`${forgedBody}.${mac}`, SECRET, 100), null, 'the mac must not validate a different body');
    assert.notEqual(body, forgedBody);
  });

  it('rejects an expired session, right at the instant of expiry', () => {
    const token = signSession({ tenantId: 'tb_t_1', issuedAt: 0, expiresAt: 1000 }, SECRET);
    assert.notEqual(verifySession(token, SECRET, 999), null, 'still valid one ms before expiry');
    assert.equal(verifySession(token, SECRET, 1000), null, 'expiry is inclusive');
  });

  it('rejects garbage input without throwing', () => {
    assert.equal(verifySession('', SECRET), null);
    assert.equal(verifySession('not-a-real-token', SECRET), null);
    assert.equal(verifySession('a.b.c', SECRET), null);
    assert.equal(verifySession(`${Buffer.from('not json').toString('base64url')}.abc`, SECRET), null);
  });
});

describe('issueSession', () => {
  it('defaults to the standard TTL and is verifiable', () => {
    const now = 1_700_000_000_000;
    const token = issueSession('tb_t_1', SECRET, { now });
    const verified = verifySession(token, SECRET, now + 1000);
    assert.equal(verified?.tenantId, 'tb_t_1');
    assert.equal(verified?.expiresAt, now + 30 * 24 * 60 * 60 * 1000);
  });

  it('honours a custom ttl', () => {
    const now = 0;
    const token = issueSession('tb_t_1', SECRET, { now, ttlMs: 5000 });
    assert.notEqual(verifySession(token, SECRET, 4999), null);
    assert.equal(verifySession(token, SECRET, 5000), null);
  });
});
