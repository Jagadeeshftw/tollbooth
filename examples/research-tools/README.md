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

```bash
git clone https://github.com/Jagadeeshftw/tollbooth
cd tollbooth
npm install
npm run build

export MOOVE_API_KEY=mk_live_...
# Only if your key names a different host. Do not guess it.
# export MOOVE_API_BASE_URL=https://api.moove.xyz

node examples/research-tools/dist/stdio.js
```

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

```ts
server.paidTool(
  'fetch_readable',
  'Fetch a web page and return its readable text.',
  { sku: 'research', cost: 1 },      // an expensive tool can cost more
  { url: z.string() },
  { readOnlyHint: true },
  async (args) => run(() => fetchReadable(String(args.url)))
);
```

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

The server listens on `/mcp` (Streamable HTTP) with a `/health` endpoint.
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

All three take a URL or domain from a model and go to the network, so the URL
guard in `src/tools.ts` refuses loopback, link-local, private ranges and
IPv4-mapped IPv6 before any request is made. If you add a tool that fetches,
use `assertPublicHttpUrl`.

## Things worth knowing

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
