import { A, Basis, H2, Mono, Note, P, Strong, Table } from "@/components/docs/prose";
import { trials } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "clients",
  title: "Client support",
  summary: "What we measured per client, what other people report, and what is untested.",
  section: "Evidence",
  toc: [
    { id: "matrix", text: "The matrix, honestly" },
    { id: "claude-code", text: "Claude Code" },
    { id: "desktop", text: "Claude Desktop" },
    { id: "cursor", text: "Cursor and the rest" },
    { id: "why-safe", text: "Why the default is safe everywhere" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="matrix">The matrix, honestly</H2>
      <P>
        Two different questions get conflated in client matrices: does the client{" "}
        <em>render</em> the challenge, and does the model <em>retry</em> after the user pays.
        Only the second closes the loop, and it is a behaviour, not a capability flag. This
        table separates what we measured from what others report and from what is unknown.
      </P>
      <Table
        head={["client", "renders structured + text", "retries after payment", "basis"]}
        rows={[
          ["Claude Code (headless)", "yes", <>{trials.shapes[0].retried}/{trials.shapes[0].n} structured · {trials.shapes[1].retried}/{trials.shapes[1].n} text</>, <Basis key="1" kind="measured" detail={trials.measuredOn} />],
          ["Claude Code (interactive)", "yes", "not separately measured", <Basis key="2" kind="unresolved" />],
          ["Claude Desktop", "expected — it is a plain tool result", "not measured", <Basis key="3" kind="unresolved" />],
          ["Cursor", "expected — it is a plain tool result", "not measured", <Basis key="4" kind="unresolved" />],
          ["VS Code Copilot, ChatGPT, others", "expected — it is a plain tool result", "not measured", <Basis key="5" kind="unresolved" />],
        ]}
      />

      <H2 id="claude-code">Claude Code</H2>
      <P>
        Measured with a blind two-turn harness: a headless session with only the test server
        attached, a task that needs the paid tool, then &ldquo;I&rsquo;ve paid, please
        continue.&rdquo; Retry and token fidelity come from the server log. Full numbers and
        method on the <A href="/docs/results">results page</A>; the harness is in the repository
        and runs against the shipped renderers.
      </P>
      <P>
        URL-mode elicitation scored {trials.shapes[2].retried}/{trials.shapes[2].n} in the same
        harness, and for a structural reason rather than a client gap — the results page has the
        exact <Mono>tool_result</Mono> the model received. Tollbooth does not ship it.
      </P>

      <H2 id="desktop">Claude Desktop</H2>
      <Note kind="unresolved" title="The one surface where the answer is genuinely unknown">
        Desktop is where a human-in-the-loop paywall matters most, and we have no data. Two
        things need a person at the app: whether the checkout link renders clickable, and
        whether the model retries. A test kit exists in the repository (<Mono>DESKTOP-TEST.md</Mono>)
        with a paste-ready config for the deployed server, the two prompts verbatim, and a
        command that reads the server log and answers the retry question objectively. If Desktop
        will not render a clickable link or will not retry, that changes the product, not the
        code — and this page will say so.
      </Note>
      <P>
        What is known from public reporting, not measured by us: Desktop does not implement MCP
        elicitation at all (either mode). That does not affect Tollbooth, which never uses it.
      </P>

      <H2 id="cursor">Cursor and the rest</H2>
      <P>
        Cursor is listed by third parties as having partial elicitation support and as
        supporting the MCP Apps extension. Neither is relevant to the shipped path: Cursor
        receives the same structured-plus-text tool result as every other client. Whether its
        model retries is <Strong>unmeasured</Strong>, and we are not going to infer it from a
        capability column.
      </P>

      <H2 id="why-safe">Why the default is safe everywhere</H2>
      <P>
        Negotiation is deny-by-default: every client — named, unnamed or unrecognised — gets
        structured content plus text, which is an ordinary tool result any client can display.
        Nothing is selected on the strength of an advertised capability, because the SDK does not
        gate mechanism on capability: a server can throw a <Mono>-32042</Mono> URL elicitation at
        a client that has never heard of one, and the user trying to pay sees a raw protocol
        error. Choosing the mechanism is the library&rsquo;s job, so it makes the safe choice
        unless told otherwise in writing.
      </P>
    </>
  );
}
