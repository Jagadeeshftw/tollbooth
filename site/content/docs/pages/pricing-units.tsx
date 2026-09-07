import { A, Basis, Code, H2, Mono, P, Strong, Table, UL } from "@/components/docs/prose";
import { mooveDocumented } from "@/content/measurements";
import { PRICES } from "@/content/snippets";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "pricing-units",
  title: "Pricing units",
  summary: "Per-call, credit packs and time passes are one record with different nulls.",
  section: "Model",
  toc: [
    { id: "model", text: "One model" },
    { id: "consume", text: "One consume" },
    { id: "cost", text: "Per-tool cost" },
    { id: "minimum", text: "The $5 minimum, and why" },
    { id: "order", text: "Which entitlement is spent first" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="model">One model</H2>
      <P>
        An entitlement has two nullable fields, and they carry the entire variation:
      </P>
      <Table
        head={["unit", "remaining", "expiresAt"]}
        rows={[
          [<Mono key="a">per_call</Mono>, "1", <Mono key="b">null</Mono>],
          [<Mono key="c">credit_pack</Mono>, "N", <><Mono>null</Mono>, or a horizon</>],
          [<Mono key="d">time_pass</Mono>, <><Mono>null</Mono> (unlimited)</>, "now + ttl"],
        ]}
      />
      <Code title="definePrice">{PRICES}</Code>
      <P>
        <Mono>definePrice</Mono> validates the invariants so the rest of the system can treat a
        price as coherent: a per-call price grants exactly one credit; a credit pack needs an
        integer count; a time pass needs a ttl and must not also grant credits. Amounts are
        decimal strings — a number is rejected at the type level and again at runtime,
        because <Mono>0.1 + 0.2</Mono> is not <Mono>0.3</Mono> and money should not go near a float.
      </P>

      <H2 id="consume">One consume</H2>
      <P>Because the units share a record, spending is one function:</P>
      <Code title="the whole of it">{`if (expiresAt !== null && now >= expiresAt)      → expired
if (remaining !== null && remaining < cost)     → insufficient_credits
if (remaining !== null) remaining -= cost`}</Code>
      <P>
        It is atomic — a compare-and-swap on the record&rsquo;s version, inside a transaction
        on the durable stores — and the <A href="/docs/stores#conformance">conformance suite</A>{" "}
        proves two concurrent calls cannot spend the same credit.
      </P>

      <H2 id="cost">Per-tool cost</H2>
      <P>
        A credit pack can charge <Mono>1</Mono> for a cheap tool and <Mono>25</Mono> for an
        expensive one. That is the main reason packs are the default: the tool author
        reprices without reissuing anything, and a <Mono>cost</Mono> greater than one is
        all-or-nothing — a rejected consume never partially spends.
      </P>

      <H2 id="minimum">The $5 minimum, and why</H2>
      <P>
        <Mono>definePrice</Mono> rejects a credit pack below <Mono>5.00</Mono> unless{" "}
        <Mono>allowBelowMinimum: true</Mono>. The floor is <em>not</em> about the provider&rsquo;s
        fee. Moove&rsquo;s protocol fee is {mooveDocumented.protocolFeeCrossChain}
        <Basis kind="documented" /> — a tenth of a cent on a $5 pack — and same-chain,
        same-token payments are {mooveDocumented.sameChainSameToken}.
      </P>
      <UL>
        <li>
          <Strong>What the payer bears.</Strong> Network gas, and a bridge relayer fee if they
          arrive from another chain. Those are the provider&rsquo;s documented costs, not ours to
          quantify; on a small pack they can rival the purchase.
        </li>
        <li>
          <Strong>What a purchase costs a human.</Strong> Reading the challenge, opening a
          browser, connecting a wallet, approving, coming back. A pack should be sized to keep
          the human out of the loop for a working session.
        </li>
      </UL>
      <P>
        The escape hatch exists for tenants who can guarantee same-chain settlement, where
        the fee is nil and gas is a fraction of a cent. The reference server uses it for one
        deliberately uneconomic $1 trial pack, pinned by a test to exactly one.
      </P>

      <H2 id="order">Which entitlement is spent first</H2>
      <P>
        Unlimited entitlements first, so a valid time pass is spent before a credit pack and
        credits are not burned needlessly. Then soonest-expiring. Then smallest balance. The
        effect is that credits the buyer would otherwise lose get used first.
      </P>
    </>
  );
}
