import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdaptiveRateLimiter, backoffDelayMs } from '../src/ratelimit.js';

describe('AdaptiveRateLimiter', () => {
  it('halves the rate on an observed 429', () => {
    const l = new AdaptiveRateLimiter({ initialRatePerSecond: 8 });
    l.onRateLimited();
    assert.equal(l.ratePerSecond, 4);
    l.onRateLimited();
    assert.equal(l.ratePerSecond, 2);
  });

  it('never drops below the floor, so a burst of 429s cannot wedge it at zero', () => {
    const l = new AdaptiveRateLimiter({ initialRatePerSecond: 8, minRatePerSecond: 0.5 });
    for (let i = 0; i < 40; i++) l.onRateLimited();
    assert.equal(l.ratePerSecond, 0.5);
  });

  it('recovers additively after sustained success, up to the ceiling', () => {
    const l = new AdaptiveRateLimiter({
      initialRatePerSecond: 1,
      maxRatePerSecond: 3,
      successesBeforeIncrease: 5,
      increaseStep: 1,
    });
    for (let i = 0; i < 5; i++) l.onSuccess();
    assert.equal(l.ratePerSecond, 2);
    for (let i = 0; i < 5; i++) l.onSuccess();
    assert.equal(l.ratePerSecond, 3);
    for (let i = 0; i < 50; i++) l.onSuccess();
    assert.equal(l.ratePerSecond, 3, 'capped at the ceiling');
  });

  it('a 429 resets progress toward the next increase', () => {
    const l = new AdaptiveRateLimiter({
      initialRatePerSecond: 4,
      successesBeforeIncrease: 3,
      increaseStep: 1,
    });
    l.onSuccess();
    l.onSuccess();
    l.onRateLimited(); // rate 2, counter cleared
    l.onSuccess();
    assert.equal(l.ratePerSecond, 2, 'the two earlier successes must not carry over');
  });

  it('actually paces requests', async () => {
    let clock = 0;
    const l = new AdaptiveRateLimiter({
      initialRatePerSecond: 10,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    // Bucket starts full at one second's worth: 10 immediate, then paced.
    for (let i = 0; i < 10; i++) await l.acquire();
    assert.equal(clock, 0, 'the initial burst is free');
    await l.acquire();
    assert.ok(clock > 0, 'the eleventh request must wait');
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially and stays inside the cap', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      for (let i = 0; i < 20; i++) {
        const d = backoffDelayMs(attempt, 1000, 30_000);
        assert.ok(d >= 0 && d <= 30_000, `delay ${d} outside bounds`);
        assert.ok(d <= Math.min(30_000, 1000 * 2 ** attempt));
      }
    }
  });

  it('uses full jitter, so retries do not synchronise', () => {
    const seen = new Set(Array.from({ length: 60 }, () => backoffDelayMs(5)));
    assert.ok(seen.size > 30, 'delays must be spread, not clustered');
  });
});
