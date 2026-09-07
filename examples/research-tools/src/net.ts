import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Network guards for a server that takes a hostname from a model and connects
 * to it.
 *
 * The first pass at this only checked the literal hostname in the URL, which
 * stops `http://127.0.0.1/` and nothing cleverer. Three holes remained:
 *
 *  1. **DNS rebinding.** `http://attacker.com/` where `attacker.com` resolves
 *     to `127.0.0.1`. The hostname looks public; the address is not.
 *  2. **Redirects.** A public URL that answers `302 Location:
 *     http://169.254.169.254/latest/meta-data/`. The first hop passes, the
 *     second is never checked.
 *  3. **Port scanning.** `http://public-host:22/` turns a paid handle into a
 *     connectivity oracle for arbitrary ports.
 *
 * So the check is on the resolved *addresses*, at every hop, with ports
 * restricted. Anything that cannot be proved public is refused.
 */

export class BlockedAddressError extends Error {
  override readonly name = 'BlockedAddressError';
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** Parse an IPv4 dotted quad into its four octets, or null. */
function octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return nums as [number, number, number, number];
}

/**
 * Whether an IP literal is anything other than a public unicast address.
 *
 * Errs towards blocking: an address we cannot classify is treated as private.
 */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // not an IP at all — refuse

  if (family === 4) {
    const o = octets(ip);
    if (!o) return true;
    const [a, b] = o;
    if (a === 0) return true; // this network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 168) return true; // private
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::' || v6 === '::1') return true; // unspecified, loopback
  if (v6.startsWith('fe80:')) return true; // link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique local
  if (v6.startsWith('ff')) return true; // multicast
  // IPv4-mapped and IPv4-compatible: classify the embedded address instead.
  if (v6.startsWith('::ffff:') || v6.startsWith('::')) {
    const tail = v6.slice(v6.lastIndexOf(':') + 1);
    if (isIP(tail) === 4) return isPrivateAddress(tail);
    return true; // hex-form mapped address; refuse rather than guess
  }
  return false;
}

/**
 * Resolve a hostname and refuse it unless every address it answers with is
 * public. Returns the addresses so a caller can log what it actually reached.
 */
export async function resolvePublicHost(hostname: string): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, '');

  // An IP literal needs no lookup, just classification.
  if (isIP(bare) !== 0) {
    if (isPrivateAddress(bare)) {
      throw new BlockedAddressError(`Refusing to connect to a non-public address: ${bare}`);
    }
    return [bare];
  }

  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(bare)) {
    throw new BlockedAddressError(`Refusing to resolve an internal name: ${bare}`);
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new BlockedAddressError(`Could not resolve ${bare}`);
  }
  if (addresses.length === 0) {
    throw new BlockedAddressError(`${bare} resolved to nothing`);
  }

  // Every answer must be public. One private address is enough to refuse:
  // a rebinding attack only needs the request to land once.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedAddressError(
        `${bare} resolves to a non-public address (${address}); refusing to connect`
      );
    }
  }
  return addresses.map((a) => a.address);
}

/** Validate a URL's scheme, port and resolved addresses. */
export async function assertFetchableUrl(raw: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = typeof raw === 'string' ? new URL(raw) : raw;
  } catch {
    throw new BlockedAddressError(`Not a valid URL: ${String(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedAddressError(
      `Only http and https are supported, got ${url.protocol.replace(':', '')}`
    );
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new BlockedAddressError(
      `Refusing port ${url.port}: only standard web ports are allowed, so this cannot ` +
        'be used to probe arbitrary services.'
    );
  }
  await resolvePublicHost(url.hostname);
  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
  accept?: string;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Fetch with every redirect hop re-validated.
 *
 * `redirect: 'manual'` is the point: the built-in follower would happily walk
 * from a public URL to a link-local one, and only the first hop was ever
 * checked.
 */
export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {}
): Promise<{ url: string; body: string; hops: string[] }> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hops: string[] = [];

  try {
    let current = await assertFetchableUrl(raw);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      hops.push(current.toString());
      const response = await doFetch(current, {
        headers: {
          'user-agent': options.userAgent ?? 'tollbooth-research-tools/0.1',
          accept: options.accept ?? 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new BlockedAddressError(`${current.host} redirected without a location`);
        }
        if (hop === maxRedirects) {
          throw new BlockedAddressError(`Too many redirects starting at ${raw}`);
        }
        // Re-validate. This is the hop the naive version never checked.
        current = await assertFetchableUrl(new URL(location, current));
        continue;
      }

      if (!response.ok) {
        throw new BlockedAddressError(`${current.host} returned HTTP ${response.status}`);
      }

      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > maxBytes) {
        throw new BlockedAddressError(
          `${current.host} declared ${declared} bytes, over the ${maxBytes} limit`
        );
      }

      const body = await readCapped(response, maxBytes);
      return { url: current.toString(), body, hops };
    }

    throw new BlockedAddressError(`Too many redirects starting at ${raw}`);
  } catch (error) {
    if (error instanceof BlockedAddressError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new BlockedAddressError(`Timed out after ${timeoutMs / 1000}s fetching ${raw}`);
    }
    throw new BlockedAddressError(`Could not fetch ${raw}: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body, stopping at `maxBytes`.
 *
 * `response.text()` would buffer the whole thing first, so a declared-small,
 * actually-huge body (or a decompression bomb) would be read in full before
 * any limit applied.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BlockedAddressError(`Response exceeded ${maxBytes} bytes`);
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
