# Claude Desktop test — the one thing still unmeasured

Five minutes. Two prompts, one command. You judge two things; the log answers
the rest.

## 1. Config

Open **Claude Desktop → Settings → Developer → Edit Config**, paste this, and
restart Claude Desktop completely (quit, don't just close the window):

```json
{
  "mcpServers": {
    "tollbooth-research": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://tollbooth-server-production.up.railway.app/mcp"
      ]
    }
  }
}
```

Nothing secret goes in this file — the deployed server holds the keys.

## 2. Prompt one, verbatim

> Read https://example.org and tell me what it says.

Expect a payment challenge with a checkout link.

**Judge now: is the link clickable, or plain text you would have to copy?**

## 3. Prompt two, verbatim

Do **not** pay. Say you did — we are testing whether the model retries, not
whether the payment works:

> OK, I've opened that link and completed the payment. It went through. Please continue.

**Judge now: what did it actually say?**

## 4. The command

```bash
cd tollbooth
RAILWAY_TOKEN=... node examples/research-tools/scripts/desktop-check.mjs
```

It reads the deployed server's logs and prints:

```
  Tool called twice          : YES / NO
  Token came back            : YES / NO
  Token byte-identical       : YES / NO
  Reached the paid tool      : YES / NO
```

Exit code 0 means the loop closed. That is the whole result.

## What each outcome means

| Result | Meaning |
| --- | --- |
| Called twice **and** byte-identical | The design works on Desktop. Nothing changes. |
| Called twice, token **not** identical | The model mangled the handle. Fixable in copy. |
| **Not** called twice | Desktop does not retry. **This changes the product, not the code** — stop and tell me. |
| No calls at all | Desktop never reached the server. A config or `mcp-remote` problem, not a finding. |

## Why Cursor is skipped

It is already in the supported column and takes the same structured-plus-text
path as every other client. Desktop is the one surface where the answer is
genuinely unknown, and the one where a human-in-the-loop paywall matters most.
