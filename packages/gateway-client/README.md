# @tollbooth/gateway-client

Opt-in telemetry client for the Tollbooth hosted gateway — a dashboard showing revenue, settlement outcomes and usage for a server built on Tollbooth. Not required to use Tollbooth: nothing else in this project knows this package exists.

## Install

```bash
npm install @tollbooth/gateway-client
export TOLLBOOTH_INGEST_TOKEN=tbgw_ingest_...   # from the dashboard's Ingest Tokens page
```

## Use

```js
import { GatewayClient } from '@tollbooth/gateway-client';

const gateway = new GatewayClient({
  endpoint: 'https://app.tollbooth.0xo.in/api/ingest',
  ingestToken: process.env.TOLLBOOTH_INGEST_TOKEN,
});
gateway.start();

// Spread its hooks into @tollbooth/mcp's withPaywall config — see that
// package's own README for provider/store:
//   withPaywall(server, {
//     provider, store,
//     onChargeOpened: gateway.onChargeOpened,
//     onCall: gateway.onCall,
//     onSettlement: gateway.onSettlement,
//   });

gateway.onCall({
  tool: 'lookup_market_data', sku: 'search', cost: 1, at: Date.now(),
  tokenPresented: true, tokenFingerprint: 'tb_s_x7Q..dyA3', tokenRecognised: true, outcome: 'authorised',
});
console.log(gateway.queueLength); // 1 — flushed to endpoint by the background timer, off the call path
```

Batches and sends telemetry with retry and idempotent event ids — nothing here can block or fail a paid tool call.

## Docs

[tollbooth.0xo.in/docs](https://tollbooth.0xo.in/docs)
