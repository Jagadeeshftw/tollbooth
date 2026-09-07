# Tollbooth

A paywall layer for MCP servers.

```bash
git clone https://github.com/Jagadeeshftw/tollbooth && cd tollbooth && npm install && npm run build
```

An AI agent calls a paid tool. The tool returns a payment challenge with a
checkout URL. A human pays. The agent retries with the handle it was given, and
the tool runs. Tollbooth is the library that does the middle of that — the
challenge, the handle, the entitlement, the settlement — and it settles
directly to the tool author's own wallet, never holding anyone else's revenue.

The design rests on one assumption no protocol guarantees: that the agent comes
back. So it was measured before it was built, in blind trials against a real
client, and the numbers — with their sample sizes and everything still
unresolved — are the first thing the documentation shows you.

- **Documentation:** https://tollbooth.0xo.in/docs
- **The measurement:** https://tollbooth.0xo.in/docs/results
- **Quickstart:** https://tollbooth.0xo.in/docs/quickstart · [`examples/research-tools`](examples/research-tools)
- **Claude Desktop test kit:** [`DESKTOP-TEST.md`](DESKTOP-TEST.md)

Pre-release; nothing is on npm yet. `npm run check` runs boundaries, generated-copy
drift, typecheck and tests. MIT.
