# @tollbooth/moove

The Moove payment-provider binding for Tollbooth: opens a checkout, settles it exactly once — on Moove's signed webhook, with polling as the fallback.

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

## Webhooks

Polling settles a charge when the agent retries. A webhook settles it the moment Moove sees the payment, so the retry finds the credits already granted. Register your endpoint in the Moove dashboard, keep the `whsec_` secret it shows you in `MOOVE_WEBHOOK_SECRET`, and route the request through this:

```js
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, parseWebhookEvent, verifyWebhookSignature } from '@tollbooth/moove';

// Call with the raw request body, before any JSON parsing, and the request's
// headers with lower-case names. Returns the status to answer with, and the
// settlement to run once you have answered.
export function handleMooveWebhook(provider, rawBody, headers) {
  const signed = verifyWebhookSignature({
    rawBody,
    signature: headers[SIGNATURE_HEADER],
    timestamp: headers[TIMESTAMP_HEADER],
    secret: process.env.MOOVE_WEBHOOK_SECRET,
  });
  if (!signed) return { status: 401 };
  const event = parseWebhookEvent(rawBody);
  if (!event) return { status: 400 };
  // Answer 2xx first: Moove retries a slow endpoint. Then settle.
  return { status: 200, settle: () => provider.settleFromWebhook(event) };
}
```

Deliveries are at least once and in no guaranteed order. That is safe: `settleFromWebhook` re-reads the link from Moove rather than trusting the payload, and a charge is granted exactly once however many times it is delivered. An unsigned or tampered delivery, or one signed more than five minutes ago, fails `verifyWebhookSignature`.

## Docs

[tollbooth.0xo.in/docs/moove-setup](https://tollbooth.0xo.in/docs/moove-setup)
