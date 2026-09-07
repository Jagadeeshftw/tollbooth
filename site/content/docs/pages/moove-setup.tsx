import { A, Basis, H2, Mono, Note, OL, P, Strong, Table, UL } from "@/components/docs/prose";
import { MOOVE, mooveDocumented } from "@/content/measurements";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "moove-setup",
  title: "Moove setup",
  summary: "Handle, default wallet, key scopes, and what a 409 means.",
  section: "Payments",
  toc: [
    { id: "account", text: "The account" },
    { id: "wallet", text: "The default wallet decides the chain" },
    { id: "key", text: "The API key and its scopes" },
    { id: "409", text: "What a 409 means" },
    { id: "payer", text: "What the payer does" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="account">The account</H2>
      <P>
        Tollbooth is multi-tenant by construction: each tool author supplies their own Moove
        key, and payments settle directly to their own wallet. There is nothing in the middle.
        Before a key can create a payment link the account needs two things:
        <Basis kind="documented" />
      </P>
      <OL>
        <li>A <Strong>handle</Strong> — the <Mono>@name</Mono> people pay.</li>
        <li>A <Strong>default wallet</Strong> — where money lands, and what it lands as.</li>
      </OL>
      <P>Both are set at <A href={MOOVE}>moove.xyz</A>, not through the API.</P>

      <H2 id="wallet">The default wallet decides the chain</H2>
      <P>
        A payment link settles to the key owner&rsquo;s default wallet, in that wallet&rsquo;s chain
        and token. <Mono>toAmount</Mono> is denominated in that token, and the caller cannot
        choose a destination. So the wallet you set is the settlement chain for every link
        Tollbooth creates.
        <Basis kind="documented" />
      </P>
      <Note kind="warn" title="Pick an L2 or Solana, not Ethereum mainnet">
        The payer bears gas and, if they arrive from another chain, a bridge cost. On Ethereum
        mainnet that can exceed a small purchase. Same-chain, same-token payments are{" "}
        {mooveDocumented.sameChainSameToken}; everything cross-chain is{" "}
        {mooveDocumented.protocolFeeCrossChain}.
        <Basis kind="documented" />
      </Note>

      <H2 id="key">The API key and its scopes</H2>
      <P>
        Keys are created in the dashboard and shown once. A key is a down-scope of the user
        who issued it: it can request a payment and read links, and nothing else. No endpoint
        moves funds, so a leaked key can create requests that pay its owner — and nothing else.
        <Basis kind="documented" />
      </P>
      <Table
        head={["scope", "grants", "Tollbooth uses it for"]}
        rows={[
          [<Mono key="1">payment_link:create</Mono>, "Creating payment links", "Opening a charge."],
          [<Mono key="2">payment_link:read</Mono>, "Listing payment links", "The reconciliation sweep. Not for polling one link."],
        ]}
      />
      <P>
        You select an <em>agent</em> rather than raw scopes; the Receive agent expands to both.
        Polling a single link uses the public by-id read and needs no scope at all — see{" "}
        <A href="/docs/rate-limits">rate limits</A>.
      </P>

      <H2 id="409">What a 409 means</H2>
      <P>
        <Mono>409 PAYMENT_LINK_ACCOUNT_NOT_READY</Mono> means the account itself is not set up
        to receive: no default wallet, or no handle. It is not transient and not a bug.
        Tollbooth surfaces it as <Mono>MooveAccountNotReadyError</Mono> with a message naming
        both things to set, and never retries it — retrying counts against the rate limit and
        fails identically. It is a <em>setup-time</em> check, so run it once when onboarding a
        tenant rather than discovering it on their first sale.
      </P>
      <P>The other codes, and which are worth retrying, are on the <A href="/docs/troubleshooting#moove">troubleshooting page</A>.</P>

      <H2 id="payer">What the payer does</H2>
      <UL>
        <li>Opens the checkout URL. No Moove account, no key, no signup, no KYC.<Basis kind="documented" /></li>
        <li>Pays in any token on any of the {mooveDocumented.chains} chains Moove supports; Moove routes and swaps to your settlement token.<Basis kind="documented" detail="Moove's own count" /></li>
        <li>For a payment link, {mooveDocumented.linkDeliversFullAmount}. The protocol fee is theirs.<Basis kind="documented" /></li>
      </UL>
      <Note kind="unresolved" title="We have not yet completed a payment ourselves">
        Everything above about the payer&rsquo;s experience is Moove&rsquo;s documentation, not our
        observation. A live payment through the deployed server is scheduled; until it lands,
        settlement latency and whether <Mono>receivedAmount</Mono> equals <Mono>toAmount</Mono>{" "}
        in practice are marked pending on the <A href="/docs/results#live">results page</A>.
      </Note>
    </>
  );
}
