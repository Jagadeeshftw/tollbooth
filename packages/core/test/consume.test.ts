import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Everything this file used to assert about consume now lives in the shared
 * store conformance suite, which runs against every backend. What is left is a
 * property of the *test harness* rather than of any store: proof that the
 * barrier the conformance suite uses actually forces an interleaving.
 */

/** Barrier that releases once `parties` callers have arrived. */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let tripped = false;
  return async () => {
    if (tripped) return;
    if (++arrived >= parties) {
      tripped = true;
      release();
      return;
    }
    await open;
  };
}

describe('the concurrency harness itself', () => {
  /**
   * Negative control. A concurrency test is worthless unless it fails against
   * the bug it claims to catch, so this asserts that the same barrier makes a
   * naive read-then-write store double-spend. If this ever stops double-spending,
   * the barrier has stopped forcing an interleaving and the tests above have
   * quietly become decorative.
   */
  it('makes a naive read-then-write store double-spend', async () => {
    const trip = barrier(2);
    let remaining = 1;

    const naiveConsume = async (): Promise<boolean> => {
      const snapshot = remaining; // read
      await trip(); // yield, exactly where MemoryEntitlementStore swaps
      if (snapshot < 1) return false;
      remaining = snapshot - 1; // write, ignoring what happened in between
      return true;
    };

    const [a, b] = await Promise.all([naiveConsume(), naiveConsume()]);
    assert.equal(
      [a, b].filter(Boolean).length,
      2,
      'the naive store must double-spend here, or the harness proves nothing'
    );
  });
});
