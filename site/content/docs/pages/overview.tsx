import { A, Basis, H2, Mono, P, Strong, UL } from "@/components/docs/prose";
import { REPO, trials } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "overview",
  title: "What Tollbooth is",
  summary: "A paywall layer for MCP servers, built on a measurement of whether agents come back.",
  section: "Start",
  toc: [
    { id: "problem", text: "The problem" },
    { id: "shape", text: "The shape of the answer" },
    { id: "not", text: "What it is not" },
    { id: "packages", text: "Packages" },
  ],
};

const s = trials.shapes;
const pct = (r: number, n: number) => Math.round((r / n) * 100);

export default function Page() {
  return (
    <>
      <P>
        An AI agent calls a paid tool. The tool returns a payment challenge with a checkout
        URL. A human pays. The agent retries with the handle it was given, and the tool
        runs. Tollbooth is the library that does the middle of that: the challenge, the
        handle, the entitlement, and the settlement.
      </P>

      <H2 id="problem">The problem</H2>
      <P>
        Most work on paid MCP tools assumes the <em>agent</em> holds a wallet and pays
        without a human. That is a coherent design, and it is the wrong one for most real
        deployments today: it means provisioning agents with funds, and it removes the
        human from a spending decision — which is precisely what MCP&rsquo;s own security
        principles insist on.
      </P>
      <P>
        The other shape — a human pays out of band, the agent resumes — rests on one
        assumption no protocol guarantees: <Strong>that the agent comes back.</Strong>{" "}
        Nothing in MCP promises a model will retry a tool after the user says they paid.
        So before building anything, we measured it.
      </P>
      <P>
        In {trials.scored} blind trials, agents retried {pct(s[1].retried, s[1].n)}–
        {pct(s[0].retried, s[0].n)}% of the time with structured and text challenges, and{" "}
        {pct(s[2].retried, s[2].n)}% with URL-mode elicitation.
        <Basis kind="measured" detail={trials.measuredOn} /> The{" "}
        <A href="/docs/results">results page</A> has the full table, the sample sizes, and
        what is still unmeasured.
      </P>

      <H2 id="shape">The shape of the answer</H2>
      <UL>
        <li>
          <Strong>Return immediately, never block.</Strong> A human paying is a
          30-second-to-minutes operation; MCP clients time out at 60 seconds and a server
          cannot extend that. See <A href="/docs/how-it-works">how it works</A>.
        </li>
        <li>
          <Strong>Mint your own handle.</Strong> MCP has no stable caller identity, so
          Tollbooth issues one and the agent carries it back as a tool argument — which is
          what the specification itself now prescribes for cross-call state.
        </li>
        <li>
          <Strong>One model, three pricing units.</Strong> Per-call, credit packs and time
          passes are one record with different nulls. See{" "}
          <A href="/docs/pricing-units">pricing units</A>.
        </li>
        <li>
          <Strong>Settle directly to the tool author.</Strong> Tollbooth never holds anyone
          else&rsquo;s revenue. The payment API it builds on has no way to send money onward,
          so there is nothing to hold and nothing to trust it with.
          <Basis kind="design" />
        </li>
      </UL>

      <H2 id="not">What it is not</H2>
      <UL>
        <li>Not a hosted service. It is a library you run on your own server.</li>
        <li>Not an x402 implementation. It is the human-in-the-loop complement to agent-pays designs, not a competitor to them.</li>
        <li>
          Not published to npm yet. Everything here is built from{" "}
          <A href={REPO}>the repository</A>.
        </li>
      </UL>

      <H2 id="packages">Packages</H2>
      <UL>
        <li><Mono>@tollbooth/core</Mono> — the entitlement model. No payment provider, no MCP. Enforced in CI.</li>
        <li><Mono>@tollbooth/mcp</Mono> — <Mono>withPaywall</Mono>, <Mono>paidTool</Mono>, the challenge renderers.</li>
        <li><Mono>@tollbooth/moove</Mono> — the Moove payment binding.</li>
        <li><Mono>@tollbooth/store-sqlite</Mono> — durable, zero-config. The library default.</li>
        <li><Mono>@tollbooth/store-postgres</Mono> — for deployment; built for Neon.</li>
        <li><Mono>@tollbooth/store-conformance</Mono> — the suite every store must pass.</li>
      </UL>
    </>
  );
}
