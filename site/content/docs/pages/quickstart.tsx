import { A, Code, H2, Mono, Note, P, Strong, UL } from "@/components/docs/prose";
import { QUICKSTART } from "@/content/measurements";
import { CLIENT, RUN, TOOL, WITH_PAYWALL } from "@/content/snippets";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "quickstart",
  title: "Quickstart",
  summary: "From zero to a paid tool. Under ten minutes if your Moove account is ready.",
  section: "Start",
  toc: [
    { id: "need", text: "What you need" },
    { id: "run", text: "Run the reference server" },
    { id: "client", text: "Point a client at it" },
    { id: "own", text: "Make your own tool paid" },
    { id: "next", text: "Where to next" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="need">What you need</H2>
      <UL>
        <li>Node 20 or newer.</li>
        <li>
          A Moove account with a <Strong>handle</Strong> and a <Strong>default wallet</Strong>{" "}
          set. Without both, link creation fails with a <Mono>409</Mono> and no retry helps.
          See <A href="/docs/moove-setup">Moove setup</A>.
        </li>
        <li>An API key from the Moove dashboard. It is shown once.</li>
      </UL>

      <H2 id="run">Run the reference server</H2>
      <Code title="shell">{RUN}</Code>
      <P>
        You should see <Mono>[research-tools] ready on stdio</Mono>. That is a complete paid
        MCP server: three research tools behind a credit pack, settling to your wallet.
      </P>

      <H2 id="client">Point a client at it</H2>
      <P>
        For a local stdio server, add it to your client&rsquo;s MCP config with{" "}
        <Mono>command: node</Mono> and the path to <Mono>dist/stdio.js</Mono>. To try the
        deployed one instead:
      </P>
      <Code title="claude_desktop_config.json / ~/.claude.json">{CLIENT}</Code>
      <P>
        Then ask for something that needs a tool — <em>Read https://example.org and tell me
        what it says</em>. The first call returns a payment challenge. Open the link, pay,
        tell the agent you have paid, and it retries with the handle.
      </P>

      <H2 id="own">Make your own tool paid</H2>
      <P>Wrap the server once:</P>
      <Code title="server.ts">{WITH_PAYWALL}</Code>
      <P>
        Then <Mono>paidTool</Mono> takes the same arguments as <Mono>registerTool</Mono>,
        plus a sku and a per-call cost. The argument order mirrors Cloudflare Agents&rsquo;{" "}
        <Mono>paidTool</Mono> so the shape is familiar.
      </P>
      <Code title="server.ts">{TOOL}</Code>
      <P>
        Tollbooth adds the <Mono>tollboothToken</Mono> argument to your tool&rsquo;s schema,
        gates the call, and hands your handler the arguments with the token already
        stripped. Unpaid calls never reach your code.
      </P>

      <Note kind="warn" title="Before this takes money from strangers">
        The reference server&rsquo;s tools take a URL from a model and fetch it. Read the{" "}
        <A href="/docs/security#ssrf">SSRF section</A> before you add a tool that reaches
        the network, and the <A href="/docs/link-ids">link id page</A> before you share a
        checkout URL anywhere public.
      </Note>

      <H2 id="next">Where to next</H2>
      <UL>
        <li>The full reference server, with its hardening notes: <A href={QUICKSTART}>examples/research-tools</A>.</li>
        <li>Choosing a store for deployment: <A href="/docs/stores">stores</A>.</li>
        <li>Every option: <A href="/docs/configuration">configuration reference</A>.</li>
      </UL>
    </>
  );
}
