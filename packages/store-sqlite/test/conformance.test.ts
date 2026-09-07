import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { runStoreConformance } from '@tollbooth/store-conformance';

import { SqliteEntitlementStore } from '../src/index.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
const paths = new WeakMap<object, string>();

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tollbooth-conf-'));
  dirs.push(dir);
  return join(dir, 'tollbooth.sqlite');
}

runStoreConformance({
  name: 'SqliteEntitlementStore',
  async create(options) {
    const path = tempDb();
    const store = new SqliteEntitlementStore({ path, ...options });
    paths.set(store, path);
    return store;
  },
  async reopen(store) {
    const path = paths.get(store);
    if (!path) throw new Error('no path recorded for this store');
    await store.close();
    const reopened = new SqliteEntitlementStore({ path });
    paths.set(reopened, path);
    return reopened;
  },
  async spawnConsumers({ store, count, subject, sku }) {
    const path = paths.get(store);
    if (!path) throw new Error('no path recorded for this store');
    // Separate processes are the only way to exercise cross-process locking;
    // two connections in one process would be serialised by better-sqlite3
    // being synchronous.
    const worker = new URL('./worker-consume.mjs', import.meta.url).pathname;
    const startAt = Date.now() + 700;
    const outputs = await Promise.all(
      Array.from({ length: count }, () =>
        execFileAsync(process.execPath, [worker, path, subject, sku, String(startAt)])
          .then((r) => r.stdout)
          .catch((e: { stdout?: string }) => e.stdout ?? '{"ok":false,"reason":"spawn-failed"}')
      )
    );
    return outputs.map((o) => JSON.parse(o) as { ok: boolean });
  },
  async cleanup() {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  },
});
