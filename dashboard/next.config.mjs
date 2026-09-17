import { fileURLToPath } from 'node:url';

/**
 * Unlike site/, which is its own independent install, this app is an npm
 * workspace member — `next` and everything else hoist to the monorepo's own
 * node_modules, not one inside dashboard/. Turbopack's root has to point
 * there too, or it cannot find its own package.
 */
const monorepoRoot = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: monorepoRoot },
  // @tollbooth/gateway-server touches `pg`, which is fine server-side but
  // must never be pulled into a client bundle — this keeps it (and the
  // packages that use it) out of the client graph explicitly rather than by
  // accident.
  serverExternalPackages: ['pg', '@tollbooth/gateway-server'],
};

export default nextConfig;
