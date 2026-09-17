import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hashIngestToken, issueIngestToken, verifyIngestToken } from '../src/ingest-tokens.js';
import { mintIngestToken, secretsEqual } from '../src/ids.js';

describe('issueIngestToken', () => {
  it('mints a token distinct from its own hash, and verifies against it', () => {
    const { token, tokenHash } = issueIngestToken();
    assert.match(token, /^tbgw_ingest_/);
    assert.notEqual(token, tokenHash);
    assert.equal(verifyIngestToken(token, tokenHash), true);
  });

  it('mints unguessably distinct tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(issueIngestToken().token);
    assert.equal(seen.size, 50);
  });

  it('the hash never contains the token, or vice versa', () => {
    const { token, tokenHash } = issueIngestToken();
    assert.ok(!tokenHash.includes(token.slice(12)), 'the hash must not embed the token');
    assert.match(tokenHash, /^[0-9a-f]{64}$/, 'sha256 hex digest');
  });
});

describe('verifyIngestToken', () => {
  it('rejects the wrong token against a real hash', () => {
    const { tokenHash } = issueIngestToken();
    assert.equal(verifyIngestToken(mintIngestToken(), tokenHash), false);
  });

  it('rejects a token one character off', () => {
    const { token, tokenHash } = issueIngestToken();
    const tampered = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    assert.equal(verifyIngestToken(tampered, tokenHash), false);
  });

  it('is exactly hashIngestToken plus a constant-time compare', () => {
    const token = mintIngestToken();
    assert.equal(verifyIngestToken(token, hashIngestToken(token)), true);
  });
});

describe('secretsEqual', () => {
  it('is true only for identical strings', () => {
    assert.equal(secretsEqual('abc', 'abc'), true);
    assert.equal(secretsEqual('abc', 'abd'), false);
  });

  it('handles differing lengths without throwing', () => {
    assert.equal(secretsEqual('abc', 'abcd'), false);
    assert.equal(secretsEqual('', 'a'), false);
    assert.equal(secretsEqual('', ''), true);
  });
});
