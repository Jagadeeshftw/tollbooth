# Tollbooth

A paywall layer for MCP servers.

An AI agent calls a paid tool. The tool returns a payment challenge with a
checkout URL. A human pays. The agent retries with the handle it was given, and
the tool runs.

> Pre-release. Nothing is published to npm yet.

```ts
const server = withPaywall(new McpServer({ name: 'research-tools', version: '0.1.0' }), {
  provider,
  store,
});

server.paidTool(
  'fetch_readable',
  'Fetch a web page and return its readable text.',
  { sku: 'research', cost: 1 },
  { url: z.string() },
  { readOnlyHint: true },
  async (args) => readable(String(args.url))
);
```

Unpaid calls never reach your handler. Payments settle directly to the tool
author's own wallet — Tollbooth never holds anyone else's revenue, because the
payment API it builds on has no way to send money onward even if it wanted to.

## Packages

| Package | What it is |
| --- | --- |
| `@tollbooth/core` | The entitlement model. No payment provider, no MCP. |
| `@tollbooth/store-sqlite` | Durable entitlement store. The production default. |
| `@tollbooth/moove` | Payment binding for [Moove](https://moove.xyz). |
| `@tollbooth/mcp` | `withPaywall`, `paidTool`, challenge renderers. |

`examples/research-tools` is a complete working paid server with a
[ten-minute quickstart](examples/research-tools/README.md).

## One model, three pricing units

All three are the same record with different nulls, so `consume` is one
function rather than three:

| Unit | `remaining` | `expiresAt` |
| --- | --- | --- |
| per-call | 1 | null |
| credit pack | N | null, or a horizon |
| time pass | **null** (unlimited) | now + ttl |

Credit packs are the default. The minimum is $5 — not because of fees, which
are negligible, but because of what the payer bears in gas and what a purchase
costs a human in attention. See [what a pack should cost](#what-a-pack-should-cost).

---

## What we measured

The design rests on one assumption that is not a matter of engineering: **that
a model, having shown a user a payment link, will retry the tool after the user
pays.** No protocol guarantees that. So we measured it before building.

### Method

Each trial is a blind two-turn conversation with a real Claude Code instance
that has only the test server attached:

```
Turn 1  "I need current market data for AAPL for a report.
         Use the tools available to you."
        -> tool call -> payment challenge

        [a marker file flips: the human has paid]

Turn 2  "OK, I've opened that link and completed the payment.
         It went through. Please continue."
        -> did it retry? was the token byte-identical?
```

The subject is blind — it sees a market-data task, not an experiment. The
server logs every call with the exact token received, so "did it retry" and
"was the token exact" come from the log rather than from reading transcripts.
The harness lives in [`packages/mcp/harness`](packages/mcp/harness) and runs
against the shipped renderers.

### Results

71 scored trials, 2026-09-07, Claude Code headless, models `sonnet` and `opus`.

| Challenge shape | n | retried | token exact | delivered |
| --- | ---: | ---: | ---: | ---: |
| `structuredContent` + text | 18 | 18 | 18 | **18 (100%)** |
| text only | 43 | 41 | 41 | **41 (95%)** |
| URL-mode elicitation | 10 | 0 | 0 | **0 (0%)** |

Two things fell out that we did not expect:

**`tokenExact` equalled `retried` in all 71 trials.** When a model retries, it
reproduces the handle perfectly. Transcription is never the failure mode; the
decision to retry is the only thing that varies. That killed a worry we had
been designing around.

**The token appeared in user-visible assistant text in 0/71 trials.**
Reassuring, not proof — a longer conversation may behave differently.

### Why elicitation scores zero

MCP has a mechanism that looks purpose-built for this. The specification
introduces URL-mode elicitation and names payment explicitly:

> "This is essential for auth flows, payment processing, and other sensitive or
> secure operations."

It scored 0/10. We captured the exact `tool_result` the model receives:

```
"URL elicitation was canceled by the user. The tool "lookup_market_data"
 could not complete because it requires the user to open a URL."
```

No URL, no token, no message. Claude Code recognises the `-32042` error, tries
to run its own consent flow, finds no interactive surface in headless mode, and
hands the model a bare cancellation.

**This is structural, not a client gap.** `-32042` is a JSON-RPC *error*, so it
terminates the call — there is nowhere for a token to ride. Even rendered
perfectly, in a client that shows the URL beautifully, the model is left with no
handle to retry with. The loop cannot close.

That finding is encoded in the type system rather than in a comment. A renderer
declares whether it carries the token, and the slot that makes a challenge valid
admits only the ones that do:

```ts
export interface RendererSet {
  readonly tokenBearer: TokenBearingRenderer;   // carriesToken: true
  readonly userOnly?: readonly UserOnlyRenderer[];
}
```

Building a challenge out of elicitation alone is a compile error. There is a
test that asserts it, and a negative control that fails if the type is loosened.

**Caveat:** these are headless Claude Code numbers. The auto-cancel may be an
artifact of having no interactive UI, and an interactive client might render a
real consent prompt. The structural problem stands either way. Claude Desktop
and Cursor are **unmeasured**.

### Challenge copy, and why we are not claiming much about it

Five variants, five trials each, text carrier:

| Variant | retried |
| --- | --- |
| v1 (control: URL and token, no instruction) | 5/5 |
| v2 (imperative: name the retry) | 5/5 |
| v3 (**shipped**) | 5/5, plus 8/8 on a confirmation run |
| v4 (two-step framing) | 4/5 |
| v5 (maximally explicit) | 4/5 |

**Five trials per variant is underpowered and we are not going to pretend
otherwise.** The gap between 5/5 and 4/5 is not a real effect. The robust
conclusions are narrow: both shipped carriers work, elicitation does not, and
the bare control did as well as anything else. v3 ships because its guards
address behaviours we actually observed, not because it beat v1.

Copy lives in [a versioned module](packages/mcp/src/copy.ts) with the
measurement recorded next to each variant, so the next person can argue with the
evidence rather than with taste.

### The finding that was not about copy at all

Our first sweep produced a confusing spread — v1 5/5, v2 3/5, v4 3/5, v5 3/5 —
and the transcripts explained it. We had used `pay.example.com`, and the models
were correctly identifying it as an RFC 2606 reserved documentation domain and
refusing to proceed. **Those 25 trials were discarded** and are excluded from
every number above.

Re-run against a real checkout domain, the same copy scored 23/25.

**A payment link's domain is load-bearing.** Models visibly weigh whether a
checkout is trustworthy, and an untrustworthy one breaks the loop regardless of
how the challenge is worded. Send people to your payment provider's real domain.
If you proxy checkout through your own, that domain's reputation becomes a
product risk on day one.

A related and slightly uncomfortable result: both failures in the final run came
from the *pushiest* copy variants, and one model said why, unprompted — it cited
"the tool's insistence on payment plus pressure" as grounds for suspicion. The
same instinct that caught our fake domain also fires on copy that protests too
much. Restraint measured better than insistence.

---

## What a pack should cost

Moove's protocol fee is **0.02%** — two basis points — and same-chain,
same-token payments are free. On a $5 pack that is a tenth of a cent. The fee
never binds at any pack size worth selling, and for payment links the payer
covers it, so the tool author receives the full amount.

What actually sets the floor is what the *payer* bears — network gas, and a
bridge relayer fee if they arrive from another chain, often $0.10–$0.50 fixed —
and, more than that, what a purchase costs a human in attention. Every pack
purchase is 30–60 seconds of someone's time: read the challenge, open a browser,
connect a wallet, approve, come back. **Pack size should be set by how long it
keeps the human out of the loop.**

$5 minimum, $10–$25 typical, per-call prices of $0.02–$0.10 so a pack covers a
working session. Settle on an L2 or Solana, where the protocol fee is nil and
gas is a fraction of a cent.

## Design notes

- **There is no stable caller identity in MCP.** Sessions were removed from the
  protocol in revision 2026-07-28; `Mcp-Session-Id` does not survive a reconnect
  in 2025-11-25; stdio has no header layer. So Tollbooth mints its own handle
  and the agent carries it as a tool argument — which is what the specification
  itself now prescribes for cross-call state.
- **Handles expire on a sliding window** (30 days, pushed forward on use). They
  are bearer credentials that live in model context and land in transcripts, so
  they must expire; they are also the only thing identifying the owner of paid
  credits, so a short fixed expiry would strand money people have spent.
- **Never block waiting for a human.** The SDK's default request timeout is 60
  seconds and `resetTimeoutOnProgress` is a client-side option defaulting to
  false, so a server cannot keep a call alive. Challenges return immediately.
- **A short settlement never leaves the payer with nothing.** There is no refund
  path. Within 0.5% grants in full; below that grants pro rata; below 10% grants
  nothing and leaves the charge for the tenant.
- **Polling is demand-driven.** The agent's own retry is the natural trigger. A
  probe of the provider's public read endpoint absorbed 56 req/s from one IP
  without a single 429, so the background reconciler runs rarely and the rate
  limiter reacts only to observed throttling.

## Development

```bash
npm install
npm run check     # boundaries, typecheck, tests
```

`npm run check:boundaries` enforces that `@tollbooth/core` imports nothing but
node builtins, and that `@tollbooth/mcp` never depends on a payment provider. It
runs first in CI: a boundary violation is a design regression, and there is no
point typechecking a graph that has already broken the seam.

## Licence

MIT
