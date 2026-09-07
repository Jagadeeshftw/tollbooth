# Tollbooth

A paywall layer for MCP servers.

An AI agent calls a paid tool. The tool returns a payment challenge with a
checkout URL. A human pays. The agent retries and the tool runs.

Status: **pre-release, under construction.** Nothing here is published yet.

## Packages

| Package | What it is |
| --- | --- |
| `@tollbooth/core` | The entitlement model. No payment provider, no MCP. |
| `@tollbooth/store-sqlite` | Durable entitlement store. The default. |
| `@tollbooth/moove` | Payment provider binding for [Moove](https://moove.xyz). |

## Licence

MIT
