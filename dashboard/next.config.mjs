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
  // `pg` is the one package a deployed function loads at runtime rather than
  // from the bundle, and it lives in the monorepo's root node_modules. Tracing
  // has to be rooted there for it to be copied into the function.
  outputFileTracingRoot: monorepoRoot,
  // pg is kept out of the bundle: it optionally imports the native `pg-native`
  // binding, which bundlers cannot resolve. @tollbooth/gateway-server is not
  // listed, and does not need to be — as a workspace package its real path is
  // outside node_modules, so it is bundled like first-party code. It stays out
  // of the client bundle because only server code imports it as a value;
  // client components import its types, which erase at compile time.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
