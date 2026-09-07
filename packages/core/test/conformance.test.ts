import { runStoreConformance } from '@tollbooth/store-conformance';

import { MemoryEntitlementStore } from '../src/memory.js';

/**
 * The reference store runs the same suite as every other store.
 *
 * It declares no `reopen`, so the durability tests are skipped rather than
 * faked — this store is deliberately not durable, and the suite says so.
 */
runStoreConformance({
  name: 'MemoryEntitlementStore',
  async create(options) {
    return new MemoryEntitlementStore({ ...options, acknowledgeEphemeral: true });
  },
  async createWithForcedInterleaving(hook) {
    return new MemoryEntitlementStore({ acknowledgeEphemeral: true, _beforeSwap: hook });
  },
});
