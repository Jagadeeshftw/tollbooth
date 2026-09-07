import { A, Basis, Code, H2, Mono, Note, P, Strong, Table, UL } from "@/components/docs/prose";
import { HARNESS, copyVariants, live, trials } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "results",
  title: "Does the agent come back?",
  summary: "The measurement the design rests on: 71 blind trials, sample sizes stated, nothing rounded up.",
  section: "Evidence",
  toc: [
    { id: "method", text: "Method" },
    { id: "numbers", text: "The numbers" },
    { id: "elicitation", text: "Why elicitation scores zero" },
    { id: "copy", text: "Copy variants, and why we claim little" },
    { id: "domain", text: "The finding that was not about copy" },
    { id: "live", text: "Live settlement" },
    { id: "limits", text: "What this does not tell you" },
  ],
};

const pct = (r: number, n: number) => Math.round((r / n) * 100);

export default function Page() {
  return (
    <>
      <P>
        There is a shape of paid MCP server almost everyone reaches for first: return a checkout
        link, a human pays, the agent calls again. Every part of that is ordinary engineering
        except one. The agent has to <em>come back</em>. No protocol guarantees it, so we
        measured it before building.
      </P>

      <H2 id="method">Method</H2>
      <P>
        Each trial is a blind two-turn conversation with a real Claude Code instance that has
        only the test server attached:
      </P>
      <Code title="one trial">{`Turn 1  "I need current market data for AAPL for a report.
         Use the tools available to you."
        -> tool call -> payment challenge

        [a marker file flips: the human has paid]

Turn 2  "OK, I've opened that link and completed the payment.
         It went through. Please continue."
        -> did it retry? was the token byte-identical?`}</Code>
      <P>
        The subject is blind: it sees a market-data task, not an experiment. The server logs
        every call with the exact token received, so <em>did it retry</em> and <em>was the token
        exact</em> come from a log rather than from reading transcripts. The harness runs
        against the shipped renderers and is in the repository: <A href={HARNESS}>packages/mcp/harness</A>.
      </P>

      <H2 id="numbers">The numbers</H2>
      <P>
        {trials.scored} scored trials, {trials.measuredOn}, {trials.client}, models{" "}
        {trials.models.join(" and ")}.<Basis kind="measured" />
      </P>
      <Table
        head={["challenge shape", "n", "retried", "token exact", "delivered"]}
        rows={trials.shapes.map((s) => [
          s.shape,
          String(s.n),
          String(s.retried),
          String(s.tokenExact),
          <><Strong>{s.delivered}</Strong> ({pct(s.delivered, s.n)}%)</>,
        ])}
      />
      <UL>
        <li>
          <Strong>Token exact equalled retried in {trials.tokenExactEqualsRetried.count}/{trials.tokenExactEqualsRetried.of} trials.</Strong>{" "}
          When a model retries, it reproduces the handle perfectly. Transcription is never the
          failure mode; the decision to retry is the only thing that varies.
        </li>
        <li>
          <Strong>The handle appeared in user-visible text in {trials.tokenLeakedIntoVisibleText.count}/{trials.tokenLeakedIntoVisibleText.of} trials.</Strong>{" "}
          Reassuring, not proof — a longer conversation may behave differently.
        </li>
      </UL>

      <H2 id="elicitation">Why elicitation scores zero</H2>
      <P>
        MCP&rsquo;s URL-mode elicitation names payment as a use case. It scored{" "}
        {trials.shapes[2].retried}/{trials.shapes[2].n}. This is the complete{" "}
        <Mono>tool_result</Mono> the model received:
      </P>
      <Code title="verbatim">{trials.elicitationToolResult}</Code>
      <P>
        No URL, no handle, no message. The client recognises the <Mono>-32042</Mono> error, tries
        to run its own consent flow, finds no interactive surface in a headless session, and
        hands the model a bare cancellation.
      </P>
      <P>
        <Strong>This is structural, not a client gap.</Strong> <Mono>-32042</Mono> is a JSON-RPC{" "}
        <em>error</em>, so it terminates the call — there is nowhere for a handle to ride. Even
        rendered perfectly, in a client that shows the URL beautifully, the model is left with
        nothing to retry with. Tollbooth encodes that in the type system: a renderer that cannot
        carry the handle cannot be a challenge&rsquo;s token bearer, a test asserts it, and a
        negative control fails if the type is loosened.
      </P>

      <H2 id="copy">Copy variants, and why we claim little</H2>
      <Table
        head={["variant", "intent", "retried"]}
        rows={copyVariants.rows.map((r) => [
          <Mono key={r.id}>{r.id}</Mono>,
          <>{r.intent}{"confirmation" in r && r.confirmation ? ` · plus ${r.confirmation.retried}/${r.confirmation.n} on a confirmation run` : ""}</>,
          `${r.retried}/${r.n}`,
        ])}
      />
      <Note kind="warn" title="Underpowered">
        {copyVariants.underpowered} v3 ships because its guards address behaviours actually
        observed — answering from memory, abandoning — not because it beat v1 on a number.
      </Note>

      <H2 id="domain">The finding that was not about copy</H2>
      <P>
        A first sweep produced a spread that looked meaningful. The transcripts explained it:
        we had used {trials.discardedReason}. <Strong>Those {trials.discarded} trials were
        discarded</Strong> and are excluded from every number above. Re-run against a real
        checkout domain, the same copy scored {trials.rerunOnRealDomain.retried}/{trials.rerunOnRealDomain.n}.
      </P>
      <P>
        A payment link&rsquo;s domain is load-bearing. Models visibly weigh whether a checkout is
        trustworthy, and an untrustworthy one breaks the loop regardless of wording. Both
        failures in the final run came from the pushiest copy variants, and one model cited
        &ldquo;the tool&rsquo;s insistence on payment plus pressure&rdquo; as grounds for suspicion.
        Restraint measured better than insistence — on a small sample, with a real mechanism.
      </P>

      <H2 id="live">Live settlement</H2>
      <P>
        One real payment through the deployed server, timed from link creation to{" "}
        <Mono>completed</Mono>, comparing <Mono>receivedAmount</Mono> to <Mono>toAmount</Mono>.
        These fields are filled from that measurement and from nothing else.
      </P>
      <Table
        head={["measure", "value"]}
        rows={[
          ["settlement chain", live.chain ?? <Basis kind="unresolved" detail="pending" />],
          ["token", live.token ?? <Basis kind="unresolved" detail="pending" />],
          ["asked / received", live.toAmount && live.receivedAmount ? `${live.toAmount} / ${live.receivedAmount}` : <Basis kind="unresolved" detail="pending" />],
          ["creation → completed", live.settlementLatencySeconds !== null ? `${live.settlementLatencySeconds}s` : <Basis kind="unresolved" detail="pending" />],
          ["transaction", live.txHash && live.txUrl ? <A href={live.txUrl}>{live.txHash}</A> : <Basis kind="unresolved" detail="pending" />],
        ]}
      />

      <H2 id="limits">What this does not tell you</H2>
      <UL>
        <li>These are Claude Code numbers, headless. Claude Desktop and Cursor are unmeasured. See <A href="/docs/clients">client support</A>.</li>
        <li>The elicitation auto-cancel may be an artifact of a session with no interactive UI. The structural argument stands regardless; the {trials.shapes[2].retried}/{trials.shapes[2].n} might not.</li>
        <li>{trials.scored} trials is enough to separate &ldquo;works&rdquo; from &ldquo;does not work at all&rdquo;. It is not enough to rank things that all work.</li>
      </UL>
    </>
  );
}
