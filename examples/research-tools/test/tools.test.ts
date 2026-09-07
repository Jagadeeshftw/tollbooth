import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PRICES } from '../src/server.js';
import { ToolError, assertPublicHttpUrl } from '../src/tools.js';

describe('URL guard', () => {
  // This server takes a URL from a model and fetches it, which is an SSRF
  // primitive if left open. These are the addresses that matter.
  const blocked = [
    'http://127.0.0.1/x',
    'http://127.1.2.3/x',
    'http://localhost/x',
    'http://app.localhost/x',
    'http://[::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://[fe80::1]/x',
    'http://0.0.0.0/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://172.31.255.255/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://db.internal/x',
    'file:///etc/passwd',
    'ftp://example.org/x',
    'gopher://example.org',
  ];

  for (const url of blocked) {
    it(`refuses ${url}`, () => {
      assert.throws(() => assertPublicHttpUrl(url), ToolError);
    });
  }

  const allowed = ['https://example.org/', 'http://example.org/a/b?c=d', 'https://172.32.0.1/x'];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      assert.doesNotThrow(() => assertPublicHttpUrl(url));
    });
  }

  it('rejects nonsense', () => {
    assert.throws(() => assertPublicHttpUrl('not a url'), /Not a valid URL/);
  });
});

describe('pricing', () => {
  it('sells credit packs, all but the trial at or above the five dollar floor', () => {
    assert.ok(PRICES.length >= 2);
    for (const price of PRICES) {
      assert.equal(price.unit, 'credit_pack');
      assert.ok((price.credits ?? 0) > 0);
      if (price.sku === 'research-trial') continue; // deliberately uneconomic
      assert.ok(Number(price.amount) >= 5, `${price.sku} is ${price.amount}`);
    }
  });

  it('keeps exactly one sub-minimum pack, and only for trialling settlement', () => {
    const cheap = PRICES.filter((p) => Number(p.amount) < 5);
    assert.equal(cheap.length, 1, 'only the trial pack may sit below the floor');
    assert.equal(cheap[0]?.sku, 'research-trial');
  });

  it('prices a credit well under a cent so a pack lasts a session', () => {
    for (const price of PRICES) {
      const perCall = Number(price.amount) / (price.credits ?? 1);
      assert.ok(perCall <= 0.1, `${price.sku} costs ${perCall} per call`);
    }
  });
});
