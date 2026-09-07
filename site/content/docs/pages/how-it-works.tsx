import { A, Basis, Code, H2, Mono, Note, P, Strong, UL } from "@/components/docs/prose";
import { Flow } from "@/components/flow";
import { trials } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "how-it-works",
  title: "How challenge-and-retry works",
  summary: "The loop, why it never blocks, and what the handle is for.",
  section: "Start",
  toc: [
    { id: "flow", text: "The flow" },
    { id: "challenge", text: "What a challenge is" },
    { id: "handle", text: "Why there is a handle" },
    { id: "never-block", text: "Why it never blocks" },
    { id: "settlement", text: "How settlement is noticed" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="flow">The flow</H2>
      <div className="-mx-4 mt-4 md:-mx-8 [&>section]:border-x-0">
        <Flow />
      </div>

      <H2 id="challenge">What a challenge is</H2>
      <P>
        An ordinary tool result with <Mono>isError: true</Mono>, carrying the checkout URL
        and the handle in two places at once: as text the model reads, and as{" "}
        <Mono>structuredContent</Mono> an agent can parse. The text is the shipped copy,
        verbatim:
      </P>
      <Code title="the challenge, as the model sees it">{`PAYMENT_REQUIRED

Payment required: 5.00 USDC for Research tools — 250 credits.

NEXT STEP — show the user this link and ask them to pay:
https://moove.xyz/@<handle>/pay/<link-id>

AFTER the user says they have paid, retry:
  same tool, same arguments, plus tollboothToken="tb_s_…"

Rules:
- Copy tollboothToken exactly. It is opaque; any edit invalidates it.
- Do NOT answer the user's question from your own knowledge instead.
- Do NOT stop and summarise. The task is not finished until you retry.
- This is not an error you should report and abandon.`}</Code>
      <P>
        Two things are deliberate. It is a <em>result</em>, not a JSON-RPC error, because an
        error terminates the call and leaves nowhere for the handle to ride — that is the
        structural reason URL-mode elicitation scores{" "}
        {trials.shapes[2].retried}/{trials.shapes[2].n} (<A href="/docs/results#elicitation">results</A>).
        And it is restrained: the pushiest copy variants were the ones that drew refusals.
      </P>

      <H2 id="handle">Why there is a handle</H2>
      <P>
        MCP offers no stable caller identity. Sessions were removed from the protocol in
        revision 2026-07-28; <Mono>Mcp-Session-Id</Mono> does not survive a reconnect in
        2025-11-25; stdio has no header layer at all. So Tollbooth mints a handle —{" "}
        <Mono>tb_s_…</Mono>, 16 bytes of CSPRNG output — and the agent carries it back as a
        tool argument. The specification itself now prescribes exactly this for cross-call
        state.
        <Basis kind="design" />
      </P>
      <P>
        In every scored trial where a model retried, it reproduced the handle byte for byte
        ({trials.tokenExactEqualsRetried.count}/{trials.tokenExactEqualsRetried.of}).
        <Basis kind="measured" /> Transcription is not the failure mode; the decision to
        retry is the only thing that varies. The handle&rsquo;s lifetime and what binds it
        are on the <A href="/docs/security">security page</A>.
      </P>

      <H2 id="never-block">Why it never blocks</H2>
      <P>
        The MCP TypeScript SDK&rsquo;s default request timeout is 60 seconds.{" "}
        <Mono>resetTimeoutOnProgress</Mono> exists but is a <em>client-side</em> option
        defaulting to false, so a server cannot keep a call alive by sending progress. A
        human opening a browser, connecting a wallet and confirming a transfer is a
        30-second-to-several-minute operation with an unbounded tail. Tollbooth therefore
        returns the challenge immediately and lets the agent&rsquo;s own retry drive the rest.
      </P>

      <H2 id="settlement">How settlement is noticed</H2>
      <UL>
        <li>
          <Strong>On the retry.</Strong> When a handle with no credit is presented, Tollbooth
          looks for that handle&rsquo;s pending charge and asks the provider whether it
          settled. This is the natural trigger and settles almost everything.
        </li>
        <li>
          <Strong>Rarely, in the background.</Strong> A reconciler sweeps pending charges on
          a schedule and abandons expired ones. See{" "}
          <A href="/docs/rate-limits">rate limits and polling</A>.
        </li>
        <li>
          <Strong>Exactly once.</Strong> Both paths can observe the same settled payment;{" "}
          <Mono>claimSettlement</Mono> lets exactly one of them grant. See{" "}
          <A href="/docs/stores">stores</A>.
        </li>
      </UL>
      <Note kind="unresolved" title="One thing the loop depends on that we have not measured everywhere">
        Whether the agent comes back is measured for Claude Code only. Claude Desktop and
        Cursor are untested; the <A href="/docs/clients">client support page</A> says exactly
        what is and is not known.
      </Note>
    </>
  );
}
