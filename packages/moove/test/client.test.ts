import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MooveClient } from '../src/client.js';
import {
  MooveAccountNotReadyError,
  MooveAmountError,
  MooveAuthError,
  MooveNotFoundError,
  MooveRateLimitError,
  MooveScopeError,
  MooveServerError,
  toMooveError,
} from '../src/errors.js';
import { AdaptiveRateLimiter } from '../src/ratelimit.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch double that replays a scripted sequence and records what it saw. */
function fakeFetch(script: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const step = script[Math.min(i, script.length - 1)]!;
    i++;
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ])
      ),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: (h: string) => step.headers?.[h.toLowerCase()] ?? null },
      json: async () => step.body,
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

function client(script: Parameters<typeof fakeFetch>[0], overrides = {}) {
  const { fn, calls } = fakeFetch(script);
  return {
    calls,
    client: new MooveClient({
      apiKey: 'mk_live_test',
      fetch: fn,
      sleep: async () => {},
      keyedLimiter: new AdaptiveRateLimiter({ initialRatePerSecond: 1e6 }),
      publicLimiter: new AdaptiveRateLimiter({ initialRatePerSecond: 1e6 }),
      ...overrides,
    }),
  };
}

const err = (code: string, message = 'boom') => ({ errors: [{ code, message }] });

describe('error mapping carries the right retry semantics', () => {
  const cases: [number, string, unknown, boolean][] = [
    [401, 'UNAUTHENTICATED', MooveAuthError, false],
    [401, 'INVALID_API_KEY', MooveAuthError, false],
    [401, 'EXPIRED_API_KEY', MooveAuthError, false],
    [403, 'INSUFFICIENT_API_SCOPE', MooveScopeError, false],
    [404, 'CANNOT_FIND_PAYMENT_LINK', MooveNotFoundError, false],
    [409, 'PAYMENT_LINK_ACCOUNT_NOT_READY', MooveAccountNotReadyError, false],
    [422, 'INVALID_PAYMENT_LINK_AMOUNT', MooveAmountError, false],
    [429, 'RATE_LIMIT_EXCEEDED', MooveRateLimitError, true],
    [500, 'CANNOT_CREATE_PAYMENT_LINK', MooveServerError, true],
  ];

  for (const [status, code, type, retryable] of cases) {
    it(`${status} ${code} -> ${(type as { name: string }).name}, retryable=${retryable}`, () => {
      const mapped = toMooveError(status, err(code));
      assert.ok(mapped instanceof (type as new (...a: never[]) => Error));
      assert.equal(mapped.retryable, retryable);
      assert.equal(mapped.code, code);
    });
  }

  it('falls back on status when the code is unrecognised', () => {
    assert.ok(toMooveError(503, err('SOMETHING_NEW')) instanceof MooveServerError);
    assert.equal(toMooveError(503, err('SOMETHING_NEW')).retryable, true);
  });

  it('409 tells the tenant exactly what to fix', () => {
    const e = toMooveError(409, err('PAYMENT_LINK_ACCOUNT_NOT_READY'));
    assert.match(e.message, /handle/i);
    assert.match(e.message, /default wallet/i);
    assert.match(e.message, /dashboard/i);
    assert.match(e.message, /Retrying will not help/i);
  });

  it('reads Retry-After when one is present', () => {
    const e = toMooveError(429, err('RATE_LIMIT_EXCEEDED'), '12') as MooveRateLimitError;
    assert.equal(e.retryAfterSeconds, 12);
  });
});

describe('retry policy', () => {
  it('never retries the 4xx family', async () => {
    for (const [status, code] of [
      [401, 'INVALID_API_KEY'],
      [403, 'INSUFFICIENT_API_SCOPE'],
      [404, 'CANNOT_FIND_PAYMENT_LINK'],
      [409, 'PAYMENT_LINK_ACCOUNT_NOT_READY'],
      [422, 'INVALID_PAYMENT_LINK_AMOUNT'],
    ] as const) {
      const { client: c, calls } = client([{ status, body: err(code) }]);
      await assert.rejects(() => c.createPaymentLink({ toAmount: '5.00' }));
      assert.equal(calls.length, 1, `${code} must not be retried, saw ${calls.length} calls`);
    }
  });

  it('retries a 429 and succeeds', async () => {
    const { client: c, calls } = client([
      { status: 429, body: err('RATE_LIMIT_EXCEEDED') },
      { status: 200, body: { id: 'pl_1', url: 'https://www.moove.xyz/pay/pl_1' } },
    ]);
    const created = await c.createPaymentLink({ toAmount: '5.00' });
    assert.equal(created.id, 'pl_1');
    assert.equal(calls.length, 2);
  });

  it('retries a 5xx and gives up after maxAttempts', async () => {
    const { client: c, calls } = client([{ status: 500, body: err('CANNOT_CREATE_PAYMENT_LINK') }], {
      maxAttempts: 3,
    });
    await assert.rejects(() => c.createPaymentLink({ toAmount: '5.00' }), MooveServerError);
    assert.equal(calls.length, 3);
  });
});

describe('createPaymentLink', () => {
  it('sends the key, a string amount, and nothing it was not given', async () => {
    const { client: c, calls } = client([
      { status: 200, body: { id: 'pl_1', url: 'https://www.moove.xyz/pay/pl_1' } },
    ]);
    await c.createPaymentLink({
      toAmount: '10.00',
      description: 'tb_abc',
      maxUsage: 1,
      expirationDate: '2026-12-31T00:00:00.000Z',
    });
    const call = calls[0]!;
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['x-api-key'], 'mk_live_test');
    assert.deepEqual(call.body, {
      toAmount: '10.00',
      description: 'tb_abc',
      maxUsage: 1,
      expirationDate: '2026-12-31T00:00:00.000Z',
    });
  });

  it('refuses a numeric amount before it reaches the wire', async () => {
    const { client: c, calls } = client([{ status: 200, body: {} }]);
    await assert.rejects(
      // @ts-expect-error deliberately passing a number
      () => c.createPaymentLink({ toAmount: 10.0 }),
      /positive decimal string/
    );
    assert.equal(calls.length, 0, 'a bad amount must not cost an API call');
  });
});

describe('readPaymentLink', () => {
  it('sends no API key, because the route is public', async () => {
    const { client: c, calls } = client([{ status: 200, body: { id: 'pl_1', status: 'active' } }]);
    await c.readPaymentLink('pl_1');
    assert.equal(calls[0]!.headers['x-api-key'], undefined, 'the public read must stay keyless');
  });

  it('falls back to an authenticated read if the route ever demands a key', async () => {
    // The route is deliberately absent from the OpenAPI document, so it can
    // change without a schema diff. This is the guard for that day.
    const { client: c, calls } = client([
      { status: 401, body: err('UNAUTHENTICATED') },
      { status: 200, body: { id: 'pl_1', status: 'completed' } },
    ]);
    const link = await c.readPaymentLink('pl_1');
    assert.equal(link.status, 'completed');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.headers['x-api-key'], undefined);
    assert.equal(calls[1]!.headers['x-api-key'], 'mk_live_test');
  });

  it('does not fall back on a 404, which is a real answer', async () => {
    const { client: c, calls } = client([{ status: 404, body: err('CANNOT_FIND_PAYMENT_LINK') }]);
    await assert.rejects(() => c.readPaymentLink('nope'), MooveNotFoundError);
    assert.equal(calls.length, 1);
  });
});

describe('listPaymentLinks', () => {
  it('is authenticated and passes status and offset through', async () => {
    const { client: c, calls } = client([
      { status: 200, body: { data: [], limit: 10, offset: 20, nextOffset: null } },
    ]);
    await c.listPaymentLinks({ status: 'completed', offset: 20 });
    assert.equal(calls[0]!.headers['x-api-key'], 'mk_live_test');
    assert.match(calls[0]!.url, /status=completed/);
    assert.match(calls[0]!.url, /offset=20/);
  });
});

describe('the API key never leaks', () => {
  it('is absent from the error surface', async () => {
    const { client: c } = client([{ status: 401, body: err('INVALID_API_KEY') }]);
    try {
      await c.createPaymentLink({ toAmount: '5.00' });
      assert.fail('should have thrown');
    } catch (error) {
      const dumped = JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error);
      assert.ok(!dumped.includes('mk_live_test'), 'the key must not appear in an error');
    }
  });
});
