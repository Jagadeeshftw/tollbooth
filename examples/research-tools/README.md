# Quickstart: a paid MCP server in under ten minutes

This is a real, working paid MCP server. Three research tools, gated behind a
credit pack, settling to your own wallet. Copy it and change the tools.

## What you need

- Node 20 or newer
- A Moove account with a **handle** and a **default wallet** set — without both,
  the API refuses to create payment links (`409`), and no amount of retrying
  helps
- An API key from <https://www.moove.xyz/dashboard/api-keys> (shown once)

## 1. Get it running (about three minutes)

<!-- snippet:RUN (generated from site/content/snippets.ts) -->
```bash
git clone ${REPO}
cd tollbooth
npm install
npm run build

export MOOVE_API_KEY=mk_live_...
# Only if your key names a different host. Do not guess it.
# export MOOVE_API_BASE_URL=https://api.moove.xyz

node examples/research-tools/dist/stdio.js
```
<!-- /snippet:RUN -->

You should see `[research-tools] ready on stdio`. That is the whole server.

## 2. Point a client at it

Add this to your MCP client config — `~/.claude.json` for Claude Code, or
`~/Library/Application Support/Claude/claude_desktop_config.json` for Claude
Desktop — then restart the client:

```json
{
  "mcpServers": {
    "research-tools": {
      "command": "node",
      "args": ["/absolute/path/to/tollbooth/examples/research-tools/dist/stdio.js"],
      "env": { "MOOVE_API_KEY": "mk_live_..." }
    }
  }
}
```

## 3. Try it

Ask the agent something that needs a tool:

> Read https://example.org and tell me what it says.

The first call comes back as a payment challenge with a checkout link. Open
it, pay, and tell the agent you have paid. It retries with the handle it was
given and the tool runs. Your 250 credits are then spent one per call until
they run out.

## 4. Make it yours

Change the prices:

```ts
export const PRICES = [
  definePrice({
    sku: 'research',
    unit: 'credit_pack',
    amount: '5.00',      // decimal string, never a number
    credits: 250,
    label: 'Research tools — 250 credits',
  }),
];
```

Change the tools. `paidTool` takes the same arguments as an ordinary
`registerTool`, plus a sku and a per-call cost:

<!-- snippet:TOOL (generated from site/content/snippets.ts) -->
```ts
server.paidTool(
  'fetch_readable',
  'Fetch a web page and return its readable text.',
  { sku: 'research', cost: 1 },   // an expensive tool can cost more
  { url: z.string() },
  { readOnlyHint: true },
  async (args) => readable(String(args.url))
);
```
<!-- /snippet:TOOL -->

Tollbooth adds the `tollboothToken` argument, gates the call, and hands your
handler the arguments with the token already stripped. Unpaid calls never reach
your code.

## Deploying it

```bash
docker build -f examples/research-tools/Dockerfile -t research-tools .
docker run -p 8080:8080 \
  -e MOOVE_API_KEY=mk_live_... \
  -v tollbooth-data:/data \
  research-tools
```

The server listens on `/mcp` (Streamable HTTP) with a `/health` endpoint. To point
a client at the deployed instance:

<!-- snippet:CLIENT (generated from site/content/snippets.ts) -->
```json
{
  "mcpServers": {
    "tollbooth-research": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${SERVER}/mcp"]
    }
  }
}
```
<!-- /snippet:CLIENT -->

`railway.json` deploys the same Dockerfile.

**Mount a volume at `/data`.** The SQLite database holds entitlements people
have already paid for. A redeploy without a volume takes their credits with
them, and there is no refund path.

## The tools

| Tool | Cost | What it does |
| --- | ---: | --- |
| `fetch_readable` | 1 | Fetches a page and returns readable text, markup and navigation stripped |
| `extract_tables` | 2 | Returns every HTML table on a page as structured headers and rows |
| `inspect_domain` | 1 | DNS records (A, AAAA, MX, NS, TXT, CNAME) plus the live TLS certificate and its expiry |

All three take a hostname from a model and connect to it, which is a
server-side request forgery primitive if left open. `src/net.ts` holds the
guards:

- **Addresses, not names.** The hostname is resolved and every answer must be
  public. A public name that resolves to `127.0.0.1` is refused — checking the
  string alone stops nothing cleverer than typing `localhost`.
- **Every redirect hop is re-validated.** `redirect: 'manual'`, because the
  built-in follower will happily walk from a public URL to link-local metadata
  and only the first hop was ever checked.
- **Ports are restricted** to 80, 443, 8080 and 8443, so a paid handle cannot
  be used as a connectivity oracle for SSH or a database.
- **Bodies are capped while streaming**, not after buffering, so a response
  that lies about its length cannot be read in full first.

`inspect_domain` runs the same address check before it opens a TLS connection.

If you add a tool that reaches the network, use `assertFetchableUrl` or
`safeFetch` — not the plain string check.

There is also a **per-handle rate limit** (2/s sustained, burst 10) and a
**20-second deadline** on every call. Credits stop free use; they do not stop
somebody who bought a pack from spending it in seconds probing hosts.

## Things worth knowing

- **A checkout URL identifies you.** Moove's read endpoint is public by design —
  the payer has no account and no key — so anyone holding a link id can read
  your wallet address, Moove handle and wallet provider. Fine to hand to the
  person paying; not fine to paste into a public issue or a shared log. See
  [what a link id reveals](../../README.md#what-a-link-id-reveals).
- **A checkout link lives for an hour** and cannot be deactivated — Moove has
  no endpoint for it, so expiry is the only containment.
- **A short settlement does not fail.** Within 0.5% it grants in full; below
  that it grants credits pro rata; below 10% it grants nothing and leaves the
  charge for you. There is no refund path, so nobody who paid ends up with
  nothing.
- **Reconciliation runs every five minutes** in the HTTP entrypoint. Most
  settlements happen on the agent's own retry; that sweep catches the rest.
- **Watch for `underpaid` in the logs.** It means somebody paid and got
  nothing, and only you can resolve it.
