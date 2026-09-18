# @tollbooth/moove

The Moove payment-provider binding for Tollbooth: opens a checkout, polls it, settles it exactly once.

## Install

```bash
npm install @tollbooth/moove
export MOOVE_API_KEY=mk_live_...   # from https://www.moove.xyz/dashboard/api-keys
```

## Use

```js
import { MemoryEntitlementStore, definePrice } from '@tollbooth/core';
import { MooveClient, MooveProvider } from '@tollbooth/moove';

const store = new MemoryEntitlementStore({ acknowledgeEphemeral: true });
const provider = new MooveProvider({
  client: new MooveClient({ apiKey: process.env.MOOVE_API_KEY }),
  store,
  prices: [definePrice({ sku: 'search', unit: 'credit_pack', amount: '5.00', credits: 10, label: 'Search — 10 credits' })],
});

console.log(provider.listPrices());
// provider.openCharge({ sku: 'search', subject }) opens a real checkout link.
```

Usually wired into [`@tollbooth/mcp`](https://www.npmjs.com/package/@tollbooth/mcp)'s `withPaywall` rather than called directly — see that package for the full paid-tool flow.

## Docs

[tollbooth.0xo.in/docs/moove-setup](https://tollbooth.0xo.in/docs/moove-setup)
