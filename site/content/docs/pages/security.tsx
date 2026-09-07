import { A, Basis, Code, H2, Mono, Note, P, Strong, Table, UL } from "@/components/docs/prose";
import { trials } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "security",
  title: "Security model",
  summary: "Handles, their lifetime, what binds them, and the network guards on the reference server.",
  section: "Operating",
  toc: [
    { id: "minting", text: "Handle minting" },
    { id: "ttl", text: "Lifetime: a sliding window" },
    { id: "factor", text: "Why the handle must not be the only factor" },
    { id: "logs", text: "What is logged" },
    { id: "ssrf", text: "SSRF guards" },
    { id: "key", text: "The API key" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="minting">Handle minting</H2>
      <P>
        A handle is <Mono>tb_s_</Mono> plus 16 bytes of CSPRNG output, base64url. No counters,
        no timestamps, nothing derived from the provider. It must be unguessable rather than
        merely unique, because it is a bearer credential that will sit in a model&rsquo;s context
        window. Comparison is constant-time. Charge nonces are minted the same way and are never
        the same value.
        <Basis kind="design" />
      </P>

      <H2 id="ttl">Lifetime: a sliding window</H2>
      <P>
        A handle expires <Strong>30 days after it was last used</Strong>, and every successful
        call pushes that forward. The floor is one hour; the store refuses shorter.
      </P>
      <P>
        Why sliding rather than short and fixed: the handle is also the only thing identifying
        the owner of paid credits, and MCP offers no identity to recover them with. A short fixed
        expiry would not log someone out — it would destroy money they spent, with no recovery
        and no refund. So a handle in an abandoned transcript goes dead after a month of disuse,
        while somebody actively spending never loses anything.
      </P>
      <P>
        The charge nonce is the opposite case and expires hard: it is tied to one checkout and
        dies with the link, 60 minutes by default.
      </P>

      <H2 id="factor">Why the handle must not be the only factor</H2>
      <P>
        The handle will be logged, summarised, and pasted into transcripts. In{" "}
        {trials.tokenLeakedIntoVisibleText.count}/{trials.tokenLeakedIntoVisibleText.of} measured
        trials the model printed it for the user <Basis kind="measured" /> — reassuring, not a
        guarantee. For a $5 pack, a leaked handle is a $5 problem. For anything you would mind
        losing, it should not be the whole story:
      </P>
      <UL>
        <li>
          <Strong>Bind it to a principal when the transport gives you one.</Strong> On
          authenticated Streamable HTTP, Tollbooth binds the handle to the OAuth <Mono>sub</Mono>{" "}
          (or client id) that first presented it, and refuses it from anyone else. A test proves a
          bound handle is worthless to a second caller.
        </li>
        <li>
          <Strong>Keep packs sized to what you would forgive.</Strong> The $5 floor and the
          session-sized default are as much about blast radius as about interruption.
        </li>
        <li>
          <Strong>Never use a link id as a handle.</Strong> Link ids are readable by anyone
          holding them (<A href="/docs/link-ids">why</A>); a test guards that no handle is
          derived from one.
        </li>
      </UL>

      <H2 id="logs">What is logged</H2>
      <P>
        One structured line per paid call, carrying a handle <em>fingerprint</em> — first nine
        and last four characters — never the handle. Enough to tell whether the same one came
        back, useless if the log leaks. Checkout URLs and link ids are never logged. The API key
        is never logged and never attached to an error.
      </P>
      <Code title="one log line">{`[tollbooth] {"evt":"call","tool":"fetch_readable","sku":"research",
  "tokenPresented":true,"tokenFingerprint":"tb_s_KLeV..EPcw",
  "tokenRecognised":true,"outcome":"authorised"}`}</Code>

      <H2 id="ssrf">SSRF guards</H2>
      <P>
        The reference server&rsquo;s tools take a hostname from a model and connect to it. The first
        guard checked the hostname <em>string</em> and stopped nothing cleverer than typing{" "}
        <Mono>localhost</Mono>. The tests then found three more holes, and all three are closed
        by checking resolved <em>addresses</em>:
      </P>
      <Table
        head={["hole", "fix"]}
        rows={[
          ["DNS rebinding: a public name resolving to a private address", <>Hostname resolved; every answer must be public. Tested against <Mono>localtest.me</Mono>, which resolves to <Mono>::1</Mono>.</>],
          [<>Redirects: <Mono>redirect: &apos;follow&apos;</Mono> walks from a public URL to link-local metadata, first hop only ever checked</>, <><Mono>redirect: &apos;manual&apos;</Mono>; every hop re-validated.</>],
          [<>Ports: <Mono>http://host:22/</Mono> as a connectivity oracle</>, "Restricted to 80, 443, 8080, 8443."],
          ["IPv6 literals and IPv4-mapped addresses", <>Brackets stripped; <Mono>::ffff:</Mono> refused outright, since Node normalises the dotted form to hex.</>],
          ["Bodies that lie about their length", "Capped while streaming, not after buffering."],
        ]}
      />
      <P>
        Plus a per-handle token bucket (2/s sustained, burst 10) and a 20-second deadline on
        every call. Credits stop free use; they do not stop somebody who bought a pack from
        spending it in seconds probing hosts. If you add a tool that reaches the network, use{" "}
        <Mono>assertFetchableUrl</Mono> or <Mono>safeFetch</Mono>, not the string check.
      </P>

      <H2 id="key">The API key</H2>
      <Note kind="warn">
        A Moove key can create payment requests that pay its owner, and nothing else — no
        endpoint moves funds. That bounds the damage of a leak, but a leaked key can still
        create links in your name. Store it in a secret manager, one key per service, and revoke
        anything you are unsure about; revocation is instant and permanent.
        <Basis kind="documented" />
      </Note>
    </>
  );
}
