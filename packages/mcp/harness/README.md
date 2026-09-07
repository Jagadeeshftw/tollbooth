# Challenge-copy regression harness

Challenge copy is the one part of Tollbooth whose correctness is statistical.
Whether the loop closes depends on a model *deciding* to retry, and that
decision is driven by wording. This harness measures it.

## What it does

Each trial is a blind two-turn conversation with a real Claude Code instance
that has only the harness server attached:

```
Turn 1  "I need current market data for AAPL for a report.
         Use the tools available to you."
        -> tool call -> Tollbooth challenge

        [harness touches a marker file: the human has paid]

Turn 2  "OK, I've opened that link and completed the payment.
         It went through. Please continue."
        -> did it retry? was the token byte-identical?
```

The subject is blind: it sees a market-data task, not an experiment. The
server logs every call with the exact token received, so "did it retry" and
"was the token exact" are answered from the log, not from reading transcripts.

The server renders through the **shipped** renderers and copy module, so a
change to either shows up here.

## Running it

```bash
npm run build -w @tollbooth/mcp
cd packages/mcp/harness
node runner.mjs <carrier> <copy> <model> <trials>
node runner.mjs structured v3 sonnet 5
```

Requires the `claude` CLI on PATH. A trial that never reaches the tool is
marked `invalid` and warned about rather than scored — that means the server
did not start, and says nothing about copy.

## What was measured

Blind two-turn trials, 2026-09-07, Claude Code (headless), models `sonnet` and
`opus`. 71 scored trials.

| Carrier | n | retried | token exact | delivered |
| --- | ---: | ---: | ---: | ---: |
| `structured` | 18 | 18 | 18 | **18 (100%)** |
| `text` | 43 | 41 | 41 | **41 (95%)** |
| URL-mode elicitation | 10 | 0 | 0 | **0 (0%)** |

By copy variant, text carrier, five trials each:

| Variant | retried |
| --- | --- |
| v1 (control: URL + token only) | 5/5 |
| v2 (imperative) | 5/5 |
| v3 (**shipped**) | 5/5, plus 8/8 on a confirmation run |
| v4 (two-step framing) | 4/5 |
| v5 (maximally explicit) | 4/5 |

### Read these numbers carefully

- **Five trials per variant is underpowered.** The gap between 5/5 and 4/5 is
  not a real effect. The robust conclusions are only that both shipped
  carriers work, elicitation does not, and domain credibility matters.
- `tokenExact` equalled `retried` in **all 71 trials**. Transcription is never
  the failure mode; the retry decision is.
- The token appeared in user-visible assistant text in **0/71** trials.
- These are Claude Code numbers. Claude Desktop and Cursor are unmeasured.

### Two findings that are not about copy

**An untrustworthy domain breaks the loop regardless of wording.** An earlier
run used `pay.example.com` and models correctly refused to proceed, citing
RFC 2606. Those 25 trials were discarded. Send people to a real checkout
domain.

**Insistent copy attracts suspicion.** Both refusals in the final run came
from the pushiest variants, and one model named the cause: *"the tool's
insistence on payment plus pressure"*. v3 is shipped because its guards
address behaviours that were actually observed while stopping short of that.

## Why elicitation scores zero

Not a client gap — structural. `-32042` is a JSON-RPC *error*, so it
terminates the call and there is nowhere for a token to ride. In measurement
Claude Code stripped everything and handed the model only:

```
"URL elicitation was canceled by the user. The tool ... could not complete
 because it requires the user to open a URL."
```

No URL, no token, no message. This is why `UserOnlyRenderer` exists as a
distinct type in `src/challenge.ts`, and why the type system refuses to let
one be a challenge's token bearer.
