// Spawned by the cross-process contention test. Opens its own pool against the
// same database and attempts exactly one consume, printing the result as JSON.
import { PostgresEntitlementStore } from '../dist/index.js';

const [, , connectionString, subject, sku, startAtMs] = process.argv;

const startAt = Number(startAtMs);
while (Date.now() < startAt) {
  /* busy-wait so every worker collides on the same instant */
}

const store = new PostgresEntitlementStore({ connectionString, migrate: false });
try {
  process.stdout.write(JSON.stringify(await store.consume(subject, sku, 1)));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, reason: 'threw', error: String(error) }));
} finally {
  await store.close();
}
