import { ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Deliberately its own variable, distinct from `TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL`
 * and never falling back to `DATABASE_URL` or `GATEWAY_DATABASE_URL` — this suite
 * truncates every gateway table on each run and must never be pointed at anything
 * by accident. Needs the same non-superuser, non-BYPASSRLS role as
 * `@tollbooth/gateway-server`'s own test suite; see that package's
 * `test/helpers.ts` for the exact `CREATE ROLE` recipe.
 */
export const CONNECTION_STRING = process.env['TOLLBOOTH_DASHBOARD_TEST_POSTGRES_URL'] ?? '';

/** Overridable, because a fixed port is only free on a machine running nothing else. */
export const TEST_PORT = Number(process.env['TOLLBOOTH_DASHBOARD_TEST_PORT'] ?? 3411);
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const SESSION_SECRET = 'dashboard-test-session-secret-never-used-outside-this-suite';

const DASHBOARD_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Next's own CLI, run with this Node directly: no npx, no shell in between. */
const NEXT_BIN = createRequire(new URL('../package.json', import.meta.url)).resolve('next/dist/bin/next');

/**
 * `currentTenantId`/`requireTenant` call `next/headers`'s `cookies()`, which
 * needs the AsyncLocalStorage request-context that only exists inside a real
 * running Next.js server — calling the route/layout functions directly, the
 * way the rest of this repo's tests call plain functions, throws. This spawns
 * an actual production server (`next start`, against a build that must
 * already exist — see `pretest` in package.json) and talks to it over real
 * HTTP, the only way to exercise that code path honestly.
 */
export async function startDashboardServer(env: Record<string, string>): Promise<ChildProcess> {
  // The readiness probe below accepts any server that answers. If one is
  // already on this port, the suite would quietly test *that* — another app's
  // dev server, say — and fail for reasons that have nothing to do with this
  // code, or worse, pass. Refuse instead.
  const occupied = await fetch(`${BASE_URL}/`, { redirect: 'manual' }).then(
    () => true,
    () => false
  );
  if (occupied) {
    throw new Error(
      `something is already listening on port ${TEST_PORT}; stop it or set TOLLBOOTH_DASHBOARD_TEST_PORT to a free port`
    );
  }

  // Started directly and as the leader of its own process group, so stopping
  // it can signal everything it started. Through `npx` the server sat behind
  // npm and a shell; on CI's Linux runners killing npx left the server running
  // and holding this process's pipes, and the suite never exited.
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(TEST_PORT)], {
    cwd: DASHBOARD_ROOT,
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dashboard server exited early (code ${child.exitCode}):\n${stderr}`);
    }
    try {
      await fetch(`${BASE_URL}/login`);
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await stopDashboardServer(child);
  throw new Error(`dashboard server did not become ready within 30s:\n${stderr}`);
}

/**
 * Stop the server and everything it started, then let go of its pipes. Safe
 * on a server that has already exited — waiting for an 'exit' that already
 * happened would hang just as surely as a server that never dies.
 */
export async function stopDashboardServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    const forced = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // already gone
      }
    }, 5_000);
    await exited;
    clearTimeout(forced);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}
