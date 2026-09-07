# Does the agent come back?

**Measuring the one assumption a human-in-the-loop MCP paywall rests on.**

---

There is a shape of paid MCP server that almost everyone reaches for first. A
tool call comes in unpaid. You return a checkout link. A human pays. The agent
calls the tool again and it works.

Every part of that is ordinary engineering except one. The agent has to *come
back*. No part of the Model Context Protocol guarantees it, no client promises
it, and it is not something you can assert in a type. It is a behaviour, and
behaviours have to be measured.

So before building [Tollbooth](https://github.com/Jagadeeshftw/tollbooth), we
measured it. This is what we found, including the parts that were inconvenient.

## The setup

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

The subject is blind: it sees a market-data task, not an experiment. The server
logs every call with the exact token it received, so *did it retry* and *was the
token exact* are answered from a log rather than by reading transcripts and
deciding what we think happened.

Three challenge shapes were tested. Two are ordinary tool results — a text error
and a text error carrying a machine-readable `structuredContent` payload. The
third is URL-mode elicitation, which the MCP specification appears to have built
for exactly this purpose.

## The numbers

71 scored trials, 2026-09-07, Claude Code headless, models `sonnet` and `opus`.

| Challenge shape | n | retried | token exact | delivered |
| --- | ---: | ---: | ---: | ---: |
| `structuredContent` + text | 18 | 18 | 18 | **18 (100%)** |
| text only | 43 | 41 | 41 | **41 (95%)** |
| URL-mode elicitation | 10 | 0 | 0 | **0 (0%)** |

The headline is that the boring approach works. A plain error result with a URL
and a token in it closes the loop about 95% of the time, and adding structured
content did not hurt.

The more useful result is the column that never varies. **`tokenExact` equalled
`retried` in all 71 trials.** When a model decides to retry, it reproduces the
opaque handle perfectly, every time. We had been designing around token
mangling — truncation, re-encoding, helpfully "fixing" the format — and it never
happened once. The only thing that varies is the decision to retry at all.

That is worth knowing if you are building something similar, because it moves
where your effort should go. Do not spend it on making handles robust to
mutation. Spend it on the wording that produces a retry.

## The mechanism built for this scores zero

MCP has URL-mode elicitation. The specification introduces it and names payments
outright:

> "This is essential for auth flows, payment processing, and other sensitive or
> secure operations."

It scored 0/10. Here is the exact `tool_result` the model receives:

```
"URL elicitation was canceled by the user. The tool "lookup_market_data"
 could not complete because it requires the user to open a URL."
```

No URL. No token. No message. Claude Code recognises the `-32042` error, tries
to run its own consent flow, finds no interactive surface in a headless session,
and hands the model a bare cancellation notice.

The models handled it about as well as anyone could. They retried, correctly
reported that they had been given nothing, and declined to claim a payment had
gone through. But the loop cannot close, because there is nothing to close it
with.

It would be easy to file this as "a client gap, fixed in a future release." It
is not. **`-32042` is a JSON-RPC error.** An error terminates the call. There is
no content field, no structured payload, nowhere for a token to ride. Even in a
client that renders the consent prompt beautifully and hands the URL to the user
perfectly, the model is left holding no handle. Elicitation can get a human to a
checkout page. It cannot get an agent back to your tool.

That is a real constraint on any design that wants both, and it is not going to
be patched away.

In Tollbooth it is encoded in the type system rather than a comment. A renderer
declares whether it carries the token back to the model, and the slot that makes
a challenge valid admits only the ones that do:

```ts
export interface RendererSet {
  readonly tokenBearer: TokenBearingRenderer;   // carriesToken: true
  readonly userOnly?: readonly UserOnlyRenderer[];
}
```

Building a challenge out of elicitation alone is a compile error. There is a
test that asserts it, and a negative control that fails if the type is ever
loosened.

## What we are not claiming about copy

We tested five wordings, five trials each:

| Variant | retried |
| --- | --- |
| v1 (control: URL and token, no instruction) | 5/5 |
| v2 (imperative: name the retry) | 5/5 |
| v3 (shipped) | 5/5, plus 8/8 on a confirmation run |
| v4 (two-step framing) | 4/5 |
| v5 (maximally explicit) | 4/5 |

**Five trials per variant is underpowered.** The gap between 5/5 and 4/5 is not
a real effect and we are not going to dress it up as one. What survives is
narrow: both ordinary carriers work, elicitation does not, and the bare control
did as well as anything more elaborate.

We ship v3 because its guards address behaviours we actually observed — models
answering from their own knowledge instead of retrying, models reporting the
challenge as a failure and stopping — not because it beat v1 on a number.

## The finding that was not about copy at all

Our first sweep produced a spread that looked meaningful: v1 5/5, v2 3/5, v4
3/5, v5 3/5. It would have been easy to write that up as "terse copy beats
verbose copy" and move on.

The transcripts said otherwise. We had used `pay.example.com` as the fake
checkout, and the models were correctly identifying it as an RFC 2606 reserved
documentation domain and refusing to proceed. They were not confused by the
copy. They were doing exactly the right thing about a suspicious payment link.

Those 25 trials were discarded. Re-run against a real checkout domain, the same
copy scored 23/25.

**A payment link's domain is load-bearing.** Models visibly weigh whether a
checkout is trustworthy, and an untrustworthy one breaks the loop no matter how
the challenge is worded. Send people to your payment provider's real domain. If
you proxy checkout through your own, that domain's reputation is now a product
risk on day one.

There is an uncomfortable corollary. Both failures in the *final* run came from
the pushiest copy variants, and one model said why, unprompted — it cited "the
tool's insistence on payment plus pressure" as grounds for suspicion. The same
instinct that caught our fake domain also fires on copy that protests too much.
The more you write "do not give up, do not stop, this is not an error", the more
you look like something a careful agent should refuse.

Restraint measured better than insistence. That is a small sample and a real
mechanism, and we would rather report both than round it to a slogan.

## What this does not tell you

- **These are Claude Code numbers, headless.** Claude Desktop and Cursor are
  unmeasured. Desktop is the surface where a human-in-the-loop paywall matters
  most, and we do not have data on it.
- **The elicitation auto-cancel may be an artifact** of a headless session with
  no interactive UI. The structural argument stands regardless; the 0/10 might
  not.
- **71 trials is a small study.** It is enough to distinguish "works" from
  "does not work at all". It is not enough to rank things that all work.

The harness is in the repository at
[`packages/mcp/harness`](https://github.com/Jagadeeshftw/tollbooth/tree/main/packages/mcp/harness).
It runs against the shipped renderers, so anyone can re-run it, change the
wording, or point it at a different model and get numbers that mean the same
thing ours do.

If you get different results, we would like to know.
