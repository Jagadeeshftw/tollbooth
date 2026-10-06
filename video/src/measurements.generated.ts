/* GENERATED from site/content/measurements.ts — do not edit. Run: npm run sync */
/**
 * Every number on the page, in one place, with where it came from.
 *
 * Rule for this file: a figure is either something we measured ourselves —
 * with the date, the sample and the method — or something a provider documents,
 * and it is labelled as one or the other. Nothing here is estimated. If a
 * section needs a number that is not in this file, the section is cut.
 *
 * Live-payment fields are `null` until the payment lands. Components render a
 * marked placeholder for `null`, so filling them in is an edit here and nothing
 * else moves.
 */

export const SITE = "tollbooth.0xo.in";
export const REPO = "https://github.com/Jagadeeshftw/tollbooth";
export const WRITEUP = "/docs/results";
export const HARNESS = `${REPO}/tree/main/packages/mcp/harness`;
export const QUICKSTART = `${REPO}/tree/main/examples/research-tools`;
/** The five-minute protocol for the one client still unmeasured. */
export const DESKTOP_TEST = `${REPO}/blob/main/DESKTOP-TEST.md`;

/**
 * The narrated demo, on YouTube: the one every surface points at (the landing
 * page and docs facade, the README). The silent render in `video/` is older and
 * stays in the repository; it is not this film. The runtime is YouTube's own
 * length for the upload, 150 s.
 */
export const VIDEO_ID = "0M-8QwF-Phw";
export const VIDEO_URL = `https://youtu.be/${VIDEO_ID}`;
export const VIDEO_RUNTIME = "2:30";
export const SERVER = "https://tollbooth-server-production.up.railway.app";
export const MOOVE = "https://moove.xyz";

/** Blind two-turn retry trials. Measured. */
export const trials = {
  measuredOn: "2026-09-07",
  client: "Claude Code (headless)",
  models: ["sonnet", "opus"],
  scored: 71,
  /** Trials thrown out because the fake checkout domain broke them. */
  discarded: 25,
  discardedReason:
    "an RFC 2606 reserved domain (example.com) as the checkout URL; models correctly refused",
  rerunOnRealDomain: { retried: 23, n: 25 },
  shapes: [
    { shape: "structuredContent + text", n: 18, retried: 18, tokenExact: 18, delivered: 18 },
    { shape: "text only", n: 43, retried: 41, tokenExact: 41, delivered: 41 },
    { shape: "URL-mode elicitation", n: 10, retried: 0, tokenExact: 0, delivered: 0 },
  ],
  /** In every scored trial, tokenExact equalled retried. */
  tokenExactEqualsRetried: { count: 71, of: 71 },
  tokenLeakedIntoVisibleText: { count: 0, of: 71 },
  /** Exactly what the model received for the elicitation shape. */
  elicitationToolResult:
    'URL elicitation was canceled by the user. The tool "lookup_market_data" could not complete because it requires the user to open a URL.',
} as const;

/** Copy variants, text carrier, five trials each. Measured, and underpowered. */
export const copyVariants = {
  perVariant: 5,
  underpowered:
    "Five trials per variant cannot separate 5/5 from 4/5. The only robust conclusions are that both shipped carriers work and elicitation does not.",
  rows: [
    { id: "v1", intent: "control: URL and token, no instruction", retried: 5, n: 5 },
    { id: "v2", intent: "imperative: name the retry", retried: 5, n: 5 },
    { id: "v3", intent: "shipped", retried: 5, n: 5, confirmation: { retried: 8, n: 8 } },
    { id: "v4", intent: "two-step framing", retried: 4, n: 5 },
    { id: "v5", intent: "maximally explicit", retried: 4, n: 5 },
  ],
} as const;

/**
 * The live settlement. `null` until the payment is made; rendered as a marked
 * placeholder. Fill these from the measurement, never by hand-estimating.
 */
export const live: {
  measuredAt: string | null;
  chain: string | null;
  token: string | null;
  toAmount: string | null;
  receivedAmount: string | null;
  settlementLatencySeconds: number | null;
  txHash: string | null;
  txUrl: string | null;
} = {
  // One real payment through the deployed server, 2026-10-05: a direct
  // transfer() from the payer on Base, settled by Moove and delivered to our
  // endpoint as a signed webhook that granted the credits.
  measuredAt: "2026-10-05",
  chain: "Base",
  token: "USDC",
  // As Moove's own link record reports them, both read back from the API.
  toAmount: "1",
  receivedAmount: "1",
  // Link creation to the delivering transaction's Base block timestamp. Most
  // of this is a person opening the link and paying, not the system.
  settlementLatencySeconds: 976.8,
  txHash: "0xf9c66c2b87388494cfc3e4467a0b5cace64a13c1dfacb7f9a4b7f2889e8ee364",
  txUrl: "https://basescan.org/tx/0xf9c66c2b87388494cfc3e4467a0b5cace64a13c1dfacb7f9a4b7f2889e8ee364",
};

/** What Moove documents. Not measured by us; labelled as documented. */
export const mooveDocumented = {
  protocolFeeCrossChain: "0.02%",
  sameChainSameToken: "free",
  /** Moove's own count, from its documentation. */
  chains: 37,
  payerHasNoAccount: true,
  linkDeliversFullAmount: "the payer's wallet is debited enough to deliver your amount in full",
} as const;

/**
 * State of the repo itself. Measured by actually running it, not counted by
 * memory — `packagesPublished` against the npm registry, `testsPassing` by
 * running every workspace's suite against a fresh Postgres. Re-run the method
 * before trusting an old date here; this is a snapshot, not a live query.
 */
export const built = {
  measuredOn: "2026-10-06",
  method:
    "packagesPublished: counted on npmjs.com under the @tollbooth scope. Tests: `npm run test` across " +
    "every workspace (core, gateway-client, gateway-server, mcp, moove, store-postgres, store-sqlite, " +
    "dashboard, example-research-tools), summed from the runner's own totals in CI run 37371645342 " +
    "(commit a7dbbea) on Node 20, 22 and 24 — identical on all three. Every Postgres suite connected " +
    "in CI's Postgres 16 service, so nothing skips, and the job fails if anything does: the entitlement " +
    "store's as the superuser, the gateway's and the dashboard's each in their own database as an " +
    "ordinary role without BYPASSRLS (a superuser would pass the row-level-security tests by bypassing " +
    "them), plus the superuser connection the gateway uses to prove it refuses one.",
  packagesPublished: 6,
  testsPassing: 499,
  testsSkipped: 0,
  testsTotal: 499,
  testFailures: 0,
  /** EntitlementStore backends, conformance-tested identically against the same suite. */
  entitlementStoreBackends: ["in-memory", "SQLite", "Postgres"],
} as const;
