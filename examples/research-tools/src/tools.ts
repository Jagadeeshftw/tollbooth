import { Resolver } from 'node:dns/promises';
import { connect } from 'node:tls';

/**
 * The three tools this server sells.
 *
 * Chosen because an agent genuinely wants them and cannot do them itself: each
 * needs network access, real parsing, or both. None of them needs a
 * third-party API key, so the example runs anywhere without extra setup.
 */

const USER_AGENT = 'tollbooth-research-tools/0.1 (+https://github.com/Jagadeeshftw/tollbooth)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;

export class ToolError extends Error {
  override readonly name = 'ToolError';
}

/**
 * Refuse anything that is not a public http(s) URL.
 *
 * This server takes a URL from a model and fetches it, which is a
 * server-side request forgery primitive if left open. Loopback, link-local and
 * private ranges are rejected before the request is made.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError(`Only http and https URLs are supported, got ${url.protocol}`);
  }
  // URL keeps the brackets on an IPv6 literal, so [::1] is not '::1'.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    // Any IPv4-mapped IPv6 address. Node normalises ::ffff:127.0.0.1 to the
    // hex form ::ffff:7f00:1, so match the prefix rather than the dotted quad.
    host.startsWith('::ffff:') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new ToolError(`Refusing to fetch a private or loopback address: ${host}`);
  }
  return url;
}

async function fetchText(url: URL): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new ToolError(`${url.host} returned HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_BYTES) throw new ToolError(`${url.host} returned more than 3MB`);
    return body;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if ((error as Error)?.name === 'AbortError') {
      throw new ToolError(`${url.host} did not respond within ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw new ToolError(`Could not fetch ${url.host}: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- readable

const BLOCK_TAGS = 'address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|p|section|tr';

/**
 * Fetch a page and return its readable text.
 *
 * Strips script, style, nav, header and footer, collapses the rest to plain
 * paragraphs. Not a browser, but enough that a model reads prose instead of
 * markup and navigation chrome.
 */
export async function fetchReadable(rawUrl: string): Promise<{
  url: string;
  title: string | null;
  text: string;
  characters: number;
}> {
  const url = assertPublicHttpUrl(rawUrl);
  const html = await fetchText(url);

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;

  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '')
    .replace(new RegExp(`</(?:${BLOCK_TAGS})>`, 'gi'), '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  return { url: url.toString(), title: decodeEntities(title), text, characters: text.length };
}

function decodeEntities(s: string | null): string | null {
  if (s === null) return null;
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------- tables

/**
 * Pull every HTML table off a page as structured rows.
 *
 * Tables are where the facts usually are, and they survive markup-stripping
 * badly — a model reading `fetchReadable` output loses the column structure
 * entirely. This keeps it.
 */
export async function extractTables(rawUrl: string): Promise<{
  url: string;
  tableCount: number;
  tables: { index: number; caption: string | null; headers: string[]; rows: string[][] }[];
}> {
  const url = assertPublicHttpUrl(rawUrl);
  const html = await fetchText(url);

  const tables: { index: number; caption: string | null; headers: string[]; rows: string[][] }[] = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tableRe.exec(html)) !== null) {
    const block = match[0];
    const caption = decodeEntities(
      /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(block)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null
    );

    const rows: string[][] = [];
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(block)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[0])) !== null) {
        cells.push(cellText(cellMatch[2] ?? ''));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) continue;

    // Treat the first row as headers when the source marked it up as such.
    const firstRowIsHeader = /<th[\s>]/i.test(block.split('</tr>')[0] ?? '');
    const headers = firstRowIsHeader ? (rows.shift() ?? []) : [];
    tables.push({ index: index++, caption, headers, rows });
  }

  return { url: url.toString(), tableCount: tables.length, tables };
}

function cellText(raw: string): string {
  return (
    decodeEntities(
      raw
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    ) ?? ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- domain

/**
 * DNS records plus the live TLS certificate for a domain.
 *
 * Answers questions an agent is often asked and cannot resolve on its own:
 * who hosts this, where does its mail go, when does its certificate expire.
 */
export async function inspectDomain(domain: string): Promise<Record<string, unknown>> {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    throw new ToolError(`Not a valid domain name: ${domain}`);
  }

  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

  const [a, aaaa, mx, ns, txt, cname] = await Promise.all([
    settle(resolver.resolve4(host)),
    settle(resolver.resolve6(host)),
    settle(resolver.resolveMx(host)),
    settle(resolver.resolveNs(host)),
    settle(resolver.resolveTxt(host)),
    settle(resolver.resolveCname(host)),
  ]);

  return {
    domain: host,
    dns: {
      a: a ?? [],
      aaaa: aaaa ?? [],
      mx: (mx ?? []).sort((x, y) => x.priority - y.priority),
      ns: ns ?? [],
      txt: (txt ?? []).map((chunks) => chunks.join('')),
      cname: cname ?? [],
    },
    tls: await inspectCertificate(host),
  };
}

function inspectCertificate(host: string): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to ? Date.parse(cert.valid_to) : NaN;
      resolve({
        subject: cert.subject?.CN ?? null,
        issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
        validFrom: cert.valid_from ?? null,
        validTo: cert.valid_to ?? null,
        daysRemaining: Number.isFinite(validTo)
          ? Math.floor((validTo - Date.now()) / 86_400_000)
          : null,
        altNames: cert.subjectaltname ?? null,
        protocol: socket.getProtocol(),
      });
      socket.end();
    });
    const fail = () => {
      socket.destroy();
      resolve(null);
    };
    socket.on('error', fail);
    socket.on('timeout', fail);
  });
}
