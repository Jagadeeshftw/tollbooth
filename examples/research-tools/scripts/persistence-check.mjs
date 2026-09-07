#!/usr/bin/env node
/**
 * Prove that entitlements survive a redeploy.
 *
 * A container filesystem does not survive a deploy, so "it still works" is not
 * evidence — the balance has to be written before, and read back after, by two
 * different processes against the same database.
 *
 *   DATABASE_URL=... node scripts/persistence-check.mjs seed     # before deploy
 *   DATABASE_URL=... node scripts/persistence-check.mjs verify   # after deploy
 *
 * `verify` spends one credit, so running it twice moves the balance. That is
 * deliberate: an unchanged number could just be a cache.
 */
import { definePrice, entitlementFromPrice, issueSubjectRecord } from '@tollbooth/core';
import { PostgresEntitlementStore } from '@tollbooth/store-postgres';

const MODE = process.argv[2];
const url = process.env.DATABASE_URL ?? process.env.TOLLBOOTH_POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const SUBJECT = 'tb_s_persistence_probe';
const NONCE = 'persistence-probe-nonce';
const PACK = definePrice({
  sku: 'research',
  unit: 'credit_pack',
  amount: '5.00',
  credits: 250,
  label: 'Research tools — 250 credits',
});

const store = new PostgresEntitlementStore({ connectionString: url });
await store.ready();

try {
  if (MODE === 'seed') {
    const now = Date.now();
    await store.putSubject(issueSubjectRecord({ subject: SUBJECT, now }));
    await store.putCharge({
      id: 'tb_c_persistence',
      nonce: NONCE,
      subject: SUBJECT,
      sku: 'research',
      amount: '5.00',
      status: 'settled',
      providerRef: 'pl_persistence_probe',
      checkoutUrl: 'https://www.moove.xyz/pay/pl_persistence_probe',
      createdAt: now,
      expiresAt: now + 3_600_000,
      settledAt: now,
      receivedAmount: '5.00',
      lastPolledAt: now,
      pollCount: 1,
    });
    await store.claimSettlement(NONCE);
    await store.grant(
      entitlementFromPrice({
        price: PACK,
        subject: SUBJECT,
        chargeId: 'tb_c_persistence',
        entitlementId: 'tb_e_persistence',
        now,
      })
    );
    const [e] = await store.listEntitlements(SUBJECT);
    console.log(JSON.stringify({ mode: 'seed', subject: SUBJECT, remaining: e?.remaining }, null, 2));
  } else if (MODE === 'verify') {
    const [entitlement] = await store.listEntitlements(SUBJECT);
    const charge = await store.getCharge(NONCE);
    const subject = await store.getSubject(SUBJECT);
    const claimAgain = await store.claimSettlement(NONCE);
    const spend = await store.consume(SUBJECT, 'research', 1);

    const result = {
      mode: 'verify',
      entitlementSurvived: Boolean(entitlement),
      balanceBefore: entitlement?.remaining ?? null,
      chargeSurvived: Boolean(charge),
      chargeStatus: charge?.status ?? null,
      chargeReceived: charge?.receivedAmount ?? null,
      subjectSurvived: Boolean(subject),
      exactlyOnceHeld: claimAgain === false,
      spendWorked: spend.ok,
      balanceAfter: spend.ok ? spend.remaining : null,
    };
    console.log(JSON.stringify(result, null, 2));

    const failures = [];
    if (!result.entitlementSurvived) failures.push('entitlement did not survive');
    if (!result.chargeSurvived) failures.push('charge history did not survive');
    if (!result.subjectSurvived) failures.push('subject handle did not survive');
    if (!result.exactlyOnceHeld) failures.push('claimSettlement handed out a second claim');
    if (!result.spendWorked) failures.push('could not spend a surviving credit');
    if (failures.length > 0) {
      console.error('\nFAILED:\n  ' + failures.join('\n  '));
      process.exit(1);
    }
    console.error('\nPASSED: balances, charges and handles survived the redeploy.');
  } else {
    console.error('usage: persistence-check.mjs seed|verify');
    process.exit(1);
  }
} finally {
  await store.close();
}
