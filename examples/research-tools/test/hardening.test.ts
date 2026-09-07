import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PerSubjectRateLimiter,
  RateLimitedError,
  TimeoutError,
  withDeadline,
} from '../src/limits.js';
import { BlockedAddressError, assertFetchableUrl, isPrivateAddress, safeFetch } from '../src/net.js';

describe('address classification', () => {
  const priv = [
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '192.0.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1',
    'not-an-ip', '', '999.1.1.1',
  ];
  for (const ip of priv) {
    it(`treats ${JSON.stringify(ip)} as non-public`, () => {
      assert.equal(isPrivateAddress(ip), true);
    });
  }

  const pub = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111'];
  for (const ip of pub) {
    it(`treats ${ip} as public`, () => {
      assert.equal(isPrivateAddress(ip), false);
    });
  }
});

describe('URL validation', () => {
  it('refuses non-web schemes', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.org/', 'gopher://example.org']) {
      await assert.rejects(() => assertFetchableUrl(url), BlockedAddressError);
    }
  });

  it('refuses non-web ports, so a handle cannot probe arbitrary services', async () => {
    for (const url of [
      'http://example.org:22/',
      'http://example.org:3306/',
      'http://example.org:6379/',
      'http://example.org:5432/',
    ]) {
      await assert.rejects(() => assertFetchableUrl(url), /Refusing port/);
    }
  });

  it('allows the standard web ports', async () => {
    await assert.doesNotReject(() => assertFetchableUrl('https://example.org/'));
    await assert.doesNotReject(() => assertFetchableUrl('http://example.org:80/'));
  });

  it('refuses a literal private address', async () => {
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/']) {
      await assert.rejects(() => assertFetchableUrl(url), BlockedAddressError);
    }
  });

  it('refuses a public-looking name that resolves to loopback', async () => {
    // DNS rebinding: the hostname passes any string check, the address does not.
    // localtest.me is a public name that resolves to 127.0.0.1 by design.
    await assert.rejects(
      () => assertFetchableUrl('http://localtest.me/'),
      /resolves to a non-public address|Could not resolve/
    );
  });

  it('refuses internal-looking names without asking DNS', async () => {
    for (const url of ['http://db.internal/', 'http://thing.local/', 'http://localhost/']) {
      await assert.rejects(() => assertFetchableUrl(url), BlockedAddressError);
    }
  });
});

describe('redirects are re-validated at every hop', () => {
  /** A fetch that answers one redirect then whatever comes next. */
  function redirectingFetch(location: string) {
    let call = 0;
    return (async () => {
      call++;
      if (call === 1) {
        return {
          ok: false,
          status: 302,
          headers: { get: (h: string) => (h === 'location' ? location : null) },
        } as unknown as Response;
      }
      throw new Error('the second hop should never have been attempted');
    }) as unknown as typeof globalThis.fetch;
  }

  it('refuses a redirect into link-local metadata', async () => {
    await assert.rejects(
      () =>
        safeFetch('https://example.org/', {
          fetchImpl: redirectingFetch('http://169.254.169.254/latest/meta-data/'),
        }),
      /non-public address|Refusing to connect/
    );
  });

  it('refuses a redirect into loopback', async () => {
    await assert.rejects(
      () => safeFetch('https://example.org/', { fetchImpl: redirectingFetch('http://127.0.0.1/') }),
      BlockedAddressError
    );
  });

  it('refuses a redirect onto a non-web port', async () => {
    await assert.rejects(
      () =>
        safeFetch('https://example.org/', {
          fetchImpl: redirectingFetch('http://example.org:22/'),
        }),
      /Refusing port/
    );
  });

  it('refuses a redirect that changes scheme to file', async () => {
    await assert.rejects(
      () => safeFetch('https://example.org/', { fetchImpl: redirectingFetch('file:///etc/passwd') }),
      BlockedAddressError
    );
  });

  it('gives up rather than following a redirect chain forever', async () => {
    const looping = (async () =>
      ({
        ok: false,
        status: 302,
        headers: { get: () => 'https://example.org/next' },
      }) as unknown as Response) as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => safeFetch('https://example.org/', { fetchImpl: looping, maxRedirects: 2 }),
      /Too many redirects/
    );
  });
});

describe('response size cap', () => {
  it('refuses a body that declares more than the limit', async () => {
    const big = (async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'content-length' ? '99999999' : null) },
      }) as unknown as Response) as unknown as typeof globalThis.fetch;
    await assert.rejects(
      () => safeFetch('https://example.org/', { fetchImpl: big, maxBytes: 1000 }),
      /over the 1000 limit/
    );
  });

  it('stops reading a body that lies about its length', async () => {
    // A declared-small, actually-huge body is the decompression-bomb shape.
    const chunk = new Uint8Array(4096);
    let sent = 0;
    const lying = (async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              sent += chunk.byteLength;
              return sent > 200_000 ? { done: true } : { done: false, value: chunk };
            },
            cancel: async () => {},
          }),
        },
      }) as unknown as Response) as unknown as typeof globalThis.fetch;

    await assert.rejects(
      () => safeFetch('https://example.org/', { fetchImpl: lying, maxBytes: 10_000 }),
      /exceeded 10000 bytes/
    );
  });
});

describe('per-subject rate limiting', () => {
  it('allows a burst then refuses', () => {
    let now = 0;
    const limiter = new PerSubjectRateLimiter({ ratePerSecond: 1, burst: 3, now: () => now });
    for (let i = 0; i < 3; i++) limiter.check('tb_s_a');
    assert.throws(() => limiter.check('tb_s_a'), RateLimitedError);
  });

  it('refills over time', () => {
    let now = 0;
    const limiter = new PerSubjectRateLimiter({ ratePerSecond: 2, burst: 2, now: () => now });
    limiter.check('tb_s_a');
    limiter.check('tb_s_a');
    assert.throws(() => limiter.check('tb_s_a'), RateLimitedError);
    now = 1000; // one second at 2/s
    assert.doesNotThrow(() => limiter.check('tb_s_a'));
  });

  it('limits each handle separately, so one caller cannot starve another', () => {
    let now = 0;
    const limiter = new PerSubjectRateLimiter({ ratePerSecond: 1, burst: 2, now: () => now });
    limiter.check('tb_s_a');
    limiter.check('tb_s_a');
    assert.throws(() => limiter.check('tb_s_a'), RateLimitedError);
    assert.doesNotThrow(() => limiter.check('tb_s_b'));
  });

  it('says how long to wait, and that credits are not the problem', () => {
    let now = 0;
    const limiter = new PerSubjectRateLimiter({ ratePerSecond: 1, burst: 1, now: () => now });
    limiter.check('tb_s_a');
    try {
      limiter.check('tb_s_a');
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof RateLimitedError);
      assert.ok(error.retryAfterMs > 0);
      assert.match(error.message, /separate from your credit balance/);
    }
  });

  it('forgets idle handles so the map cannot grow without bound', () => {
    let now = 0;
    const limiter = new PerSubjectRateLimiter({
      ratePerSecond: 1,
      burst: 1,
      idleEvictionMs: 1000,
      now: () => now,
    });
    for (let i = 0; i < 50; i++) limiter.check(`tb_s_${i}`);
    assert.equal(limiter.size, 50);
    now = 10_000;
    limiter.check('tb_s_fresh');
    assert.ok(limiter.size < 50, `expected eviction, still holding ${limiter.size}`);
  });
});

describe('tool deadline', () => {
  it('stops a call that runs too long', async () => {
    await assert.rejects(
      () => withDeadline(20, () => new Promise((r) => setTimeout(r, 5000))),
      TimeoutError
    );
  });

  it('lets a fast call through', async () => {
    assert.equal(await withDeadline(1000, async () => 'done'), 'done');
  });

  it('does not swallow a real error', async () => {
    await assert.rejects(
      () => withDeadline(1000, async () => { throw new Error('boom'); }),
      /boom/
    );
  });
});
