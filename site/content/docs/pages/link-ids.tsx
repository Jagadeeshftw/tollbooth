import { A, Basis, H2, Mono, P, Strong, Table, UL } from "@/components/docs/prose";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "link-ids",
  title: "What a link id reveals",
  summary: "A checkout URL identifies the tool author to anyone holding it. A property of the design, not a defect.",
  section: "Payments",
  toc: [
    { id: "why", text: "Why the read is public" },
    { id: "what", text: "What it discloses" },
    { id: "follows", text: "What follows" },
  ],
};

export default function Page() {
  return (
    <>
      <P>
        <Strong>A Moove payment-link id is not a secret, and anyone holding one can read the
        payee&rsquo;s identity.</Strong>
      </P>

      <H2 id="why">Why the read is public</H2>
      <P>
        <Mono>GET /v1/payment-link/{"{id}"}</Mono> takes no key — by design, because the payer
        has no Moove account and no key, so the hosted checkout page has to be able to read the
        link it renders. Tollbooth depends on exactly that: it is what lets a server poll for
        settlement without spending its own rate-limit budget, and what would let a hosted
        gateway poll without ever holding a tenant&rsquo;s key.
      </P>
      <P>
        We confirmed it directly: a read of a real link id with no <Mono>X-API-Key</Mono> header
        returns the full object.
        <Basis kind="measured" detail="2026-09-07" />
      </P>

      <H2 id="what">What it discloses</H2>
      <Table
        head={["field", "what it reveals"]}
        rows={[
          [<Mono key="1">destinationAddress</Mono>, "The tenant's settlement wallet address"],
          [<Mono key="2">userId</Mono>, "The tenant's Moove account id"],
          [<Mono key="3">user.handle</Mono>, "The tenant's Moove handle"],
          [<Mono key="4">user.wallet.provider</Mono>, "Which wallet they use, e.g. MetaMask"],
          [<><Mono>toAmount</Mono>, <Mono>status</Mono>, <Mono>receivedAmount</Mono>, <Mono>transactionUrl</Mono></>, "The charge itself"],
        ]}
      />

      <H2 id="follows">What follows</H2>
      <UL>
        <li>
          A checkout URL contains a link id. Treat it as you would any link that identifies you:
          fine to hand to the person paying, not fine to paste into a public issue or a shared log.
        </li>
        <li>
          Tollbooth never logs a checkout URL or a link id. The fingerprints it logs are of
          handles, and a handle is never derived from a link id — a test guards that.
        </li>
        <li>
          Tollbooth never uses a link id as a handle, for the same reason: it would be a
          bearer credential anyone could read.
        </li>
        <li>
          If you would rather your wallet address were not derivable from a checkout URL, this
          provider cannot give you that. It is inherent to a public read, not something a flag
          turns off.
        </li>
      </UL>
      <P>
        The operator dashboard, when it ships, shows fingerprints only — never a handle, never a
        link id — for the same reason. See <A href="/docs/security">security</A>.
      </P>
    </>
  );
}
