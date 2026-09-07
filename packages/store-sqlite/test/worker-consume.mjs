// Spawned by the multi-process test. Opens its own connection to the shared
// database file and attempts exactly one consume, printing the result as JSON.
//
// Separate processes are the only way to exercise the cross-process locking
// that the "durable" claim rests on; two connections inside one process would
// be serialised by better-sqlite3 being synchronous.

import { SqliteEntitlementStore } from '../dist/index.js';

const [, , dbPath, subject, sku, startAtMs] = process.argv;

// All workers spin until a shared wall-clock instant, so they collide.
const startAt = Number(startAtMs);
while (Date.now() < startAt) {
  /* deliberate busy-wait: sleeping would blur the collision */
}

// Construction is inside the try on purpose: opening the database runs the
// schema DDL, and twelve processes doing that at once can fail. A worker that
// dies here writes nothing, and the harness then has an empty string to parse
// rather than a reason.
let store;
try {
  store = new SqliteEntitlementStore({ path: dbPath });
  const result = await store.consume(subject, sku, 1);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, reason: 'threw', error: String(error) }));
} finally {
  await store?.close();
}
