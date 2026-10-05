import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { webhookRejectionReason } from '../src/webhook-rejection.js';

describe('webhookRejectionReason', () => {
  const now = 1_800_000_000;

  it('names missing headers', () => {
    assert.equal(webhookRejectionReason({ signature: undefined, timestamp: String(now), nowSeconds: now }), 'missing signature headers');
    assert.equal(webhookRejectionReason({ signature: 'v1=ab', timestamp: undefined, nowSeconds: now }), 'missing signature headers');
  });

  it('tells a stale delivery apart from a mis-signed fresh one', () => {
    assert.match(webhookRejectionReason({ signature: 'v1=ab', timestamp: String(now - 900), nowSeconds: now }), /^stale timestamp \(signed 900s ago/);
    assert.match(webhookRejectionReason({ signature: 'v1=ab', timestamp: String(now - 2), nowSeconds: now }), /^signature mismatch while fresh \(signed 2s ago\)/);
  });

  it('treats a millisecond timestamp as stale rather than guessing', () => {
    assert.match(webhookRejectionReason({ signature: 'v1=ab', timestamp: String(now * 1000), nowSeconds: now }), /^stale timestamp/);
  });

  it('names a timestamp that is not a number', () => {
    assert.equal(webhookRejectionReason({ signature: 'v1=ab', timestamp: 'yesterday', nowSeconds: now }), 'timestamp is not a number');
  });
});
