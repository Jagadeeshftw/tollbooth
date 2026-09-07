import { A, Basis, H2, Mono, Note, P, Strong, Table } from "@/components/docs/prose";
import { live, mooveDocumented } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "underpayment",
  title: "The underpayment policy",
  summary: "Three zones, chosen because there is no refund path.",
  section: "Payments",
  toc: [
    { id: "why", text: "Why there is a policy at all" },
    { id: "zones", text: "The three zones" },
    { id: "passes", text: "Time passes" },
    { id: "exact", text: "Exactness" },
    { id: "expect", text: "Whether it ever fires" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="why">Why there is a policy at all</H2>
      <P>
        Moove has no Send endpoint. That is what makes Tollbooth safe to run multi-tenant — a
        leaked key cannot redirect money — and it also means there is <Strong>no refund
        path</Strong>. So a settlement that arrives short must never end with the payer holding
        nothing. The bands below trade a small amount of revenue for never stranding someone who
        actually paid.
      </P>

      <H2 id="zones">The three zones</H2>
      <Table
        head={["received, as a fraction of asked", "what is granted", "charge status"]}
        rows={[
          ["≥ 99.5%", "The full pack", <Mono key="1">settled</Mono>],
          ["10% ≤ r < 99.5%", "Credits scaled to what landed, floored at one", <Mono key="2">settled</Mono>],
          ["< 10%", "Nothing", <><Mono>pending</Mono> — stays visible to the tenant</>],
        ]}
      />
      <P>
        The tolerance band exists because Moove documents a market-quote slippage tolerance of
        0.10% <Basis kind="documented" />; 0.5% absorbs it with room rather than punishing a
        payer for a route that filled a shade under quote. Below the floor the charge is left
        pending on purpose: with no refund it cannot be closed quietly, so reconciliation keeps
        raising it until a person decides. Both thresholds are configurable — see{" "}
        <A href="/docs/configuration#provider">configuration</A>.
      </P>

      <H2 id="passes">Time passes</H2>
      <P>
        A pass has no credits to scale, so a short settlement scales its <em>duration</em>{" "}
        instead: a quarter of the money buys a quarter of the day.
      </P>

      <H2 id="exact">Exactness</H2>
      <P>
        The ratio is computed on bigints in parts per million, so the decision itself involves
        no floating point. Scaled credits are floored, never rounded in the tenant&rsquo;s favour.
        A <Mono>receivedAmount</Mono> of <Mono>null</Mono> is treated as full: a completed link
        with no figure to check is not evidence of a shortfall.
      </P>
      <P>
        One trap the probes found: <Mono>toAmount</Mono> is normalised on read — a{" "}
        <Mono>&quot;1.00&quot;</Mono> comes back as <Mono>&quot;1&quot;</Mono>. Comparisons are
        scale-aligned, so this is handled, but a naive string equality would report a false
        shortfall on a payment that was exactly right.
        <Basis kind="measured" />
      </P>

      <H2 id="expect">Whether it ever fires</H2>
      <P>
        For a payment link, Moove documents that {mooveDocumented.linkDeliversFullAmount}, and
        that the payer covers the fee.
        <Basis kind="documented" /> If that holds, the policy never fires on a clean payment.
      </P>
      <Note kind="unresolved" title="Not yet confirmed by a real payment">
        {live.receivedAmount && live.toAmount
          ? `Measured: asked ${live.toAmount}, received ${live.receivedAmount}.`
          : "A live payment is scheduled. Until it lands, whether receivedAmount equals toAmount in practice is marked pending on the results page, and the policy is documented behaviour rather than observed behaviour."}
      </Note>
    </>
  );
}
