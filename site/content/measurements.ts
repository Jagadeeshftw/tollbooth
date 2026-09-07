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

export const REPO = "https://github.com/Jagadeeshftw/tollbooth";
export const WRITEUP = `${REPO}/blob/main/docs/does-the-agent-come-back.md`;
export const HARNESS = `${REPO}/tree/main/packages/mcp/harness`;
export const QUICKSTART = `${REPO}/tree/main/examples/research-tools`;
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
  measuredAt: null,
  chain: null,
  token: null,
  toAmount: null,
  receivedAmount: null,
  settlementLatencySeconds: null,
  txHash: null,
  txUrl: null,
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
