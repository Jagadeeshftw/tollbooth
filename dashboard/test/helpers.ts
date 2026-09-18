import { ChildProcess, spawn } from 'node:child_process';
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

export const TEST_PORT = 3411;
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const SESSION_SECRET = 'dashboard-test-session-secret-never-used-outside-this-suite';

const DASHBOARD_ROOT = fileURLToPath(new URL('..', import.meta.url));

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
  const child = spawn('npx', ['next', 'start', '-p', String(TEST_PORT)], {
    cwd: DASHBOARD_ROOT,
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
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
  child.kill();
  throw new Error(`dashboard server did not become ready within 30s:\n${stderr}`);
}

export async function stopDashboardServer(child: ChildProcess): Promise<void> {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}
