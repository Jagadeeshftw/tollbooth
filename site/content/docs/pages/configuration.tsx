import { A, Code, H2, Mono, P, Table } from "@/components/docs/prose";
import { SETTLEMENT_POLICY } from "@/content/snippets";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "configuration",
  title: "Configuration reference",
  summary: "Every option on withPaywall, paidTool, the Moove provider and the stores.",
  section: "Model",
  toc: [
    { id: "withpaywall", text: "withPaywall" },
    { id: "paidtool", text: "paidTool" },
    { id: "provider", text: "MooveProvider" },
    { id: "client", text: "MooveClient" },
    { id: "stores", text: "Stores" },
    { id: "env", text: "Reference server environment" },
  ],
};

const M = ({ children }: { children: string }) => <Mono>{children}</Mono>;

export default function Page() {
  return (
    <>
      <H2 id="withpaywall">withPaywall(server, config)</H2>
      <Table
        head={["option", "type", "default", "what it does"]}
        rows={[
          [<M key="1">provider</M>, <M key="2">PaymentProvider</M>, "required", "Opens charges, settles them, issues handles."],
          [<M key="3">store</M>, <M key="4">EntitlementStore</M>, "required", "Where credits are spent from. Passed explicitly, never reached for."],
          [<M key="5">argumentName</M>, "string", <M key="6">tollboothToken</M>, "The tool argument the agent carries the handle back in."],
          [<M key="7">copyId</M>, "string", <M key="8">v3</M>, "Challenge copy variant. All five are measured; v3 ships."],
          [<M key="9">allow</M>, "string[]", "none", "Renderer ids permitted beyond the default. Deny-by-default otherwise."],
          [<M key="10">onSettlement</M>, "fn(outcome)", "—", "Every settlement observation. Log underpaid loudly."],
          [<M key="11">onCall</M>, "fn(event)", "—", "Every paid call, with a handle fingerprint — never the handle."],
          [<M key="12">now</M>, "() ⇒ number", <M key="13">Date.now</M>, "Injected clock. Must agree with the provider's."],
        ]}
      />

      <H2 id="paidtool">server.paidTool(name, description, pricing, inputSchema, annotations, handler)</H2>
      <P>
        Argument order mirrors Cloudflare Agents&rsquo; <M>paidTool</M>. <M>pricing</M> is a sku
        string or <M>{`{ sku, cost }`}</M>; <M>cost</M> defaults to 1 and must be a positive
        integer. The sku must already be sold by the provider, or registration throws. The
        handler receives the arguments with the handle stripped, and <M>extra.tollbooth</M>{" "}
        set to <M>{`{ subject, sku, cost }`}</M> so a server can rate-limit per handle.
      </P>

      <H2 id="provider">new MooveProvider(options)</H2>
      <Code title="all options">{SETTLEMENT_POLICY}</Code>
      <Table
        head={["option", "default", "floor", "notes"]}
        rows={[
          [<M key="1">chargeTtlMs</M>, "60 min", "15 min", "How long a checkout stays payable. There is no deactivation endpoint; expiry is the only containment."],
          [<M key="2">settlementPolicy.toleranceFraction</M>, "0.005", "0", <>Within this shortfall, grant in full. See <A href="/docs/underpayment">underpayment</A>.</>],
          [<M key="3">settlementPolicy.minimumFraction</M>, "0.1", "0", "Below this fraction, grant nothing. Must leave room below the tolerance band."],
          [<M key="4">subjectTtlMs</M>, "30 days", "1 hour", <>Sliding window on a handle. See <A href="/docs/security#ttl">security</A>.</>],
          [<M key="5">prices</M>, "required", "—", "Everything this server sells."],
        ]}
      />

      <H2 id="client">new MooveClient(options)</H2>
      <Table
        head={["option", "default", "notes"]}
        rows={[
          [<M key="1">apiKey</M>, "required", "Held here and never leaves: not logged, not attached to errors, not sent on the public read."],
          [<M key="2">baseUrl</M>, <M key="3">https://api.moove.xyz</M>, "The host shown next to your key. Never guess it."],
          [<M key="4">maxAttempts</M>, "4", "Retries for 429 and 5xx only. The 4xx family is never retried."],
          [<M key="5">keyedLimiter</M>, "2 req/s", "Governs authenticated calls, which consume the per-key budget."],
          [<M key="6">publicLimiter</M>, "8 req/s", "Governs the keyless read, which consumes only the per-IP budget."],
        ]}
      />
      <P>
        The limiter defaults are deliberately conservative despite measured headroom; the{" "}
        <A href="/docs/rate-limits">rate limits page</A> says why.
      </P>

      <H2 id="stores">Stores</H2>
      <Table
        head={["store", "option", "notes"]}
        rows={[
          [<M key="1">MemoryEntitlementStore</M>, <M key="2">acknowledgeEphemeral</M>, "Required outside tests; the store warns otherwise. Loses paid credits on restart."],
          [<M key="3">SqliteEntitlementStore</M>, <M key="4">path</M>, "File path or :memory:. WAL mode; busyTimeoutMs defaults to 5000."],
          [<M key="5">PostgresEntitlementStore</M>, <M key="6">connectionString</M>, "Use Neon's pooled host. max (5), maxRetries (5), retryBaseMs (250), migrate (true)."],
        ]}
      />

      <H2 id="env">Reference server environment</H2>
      <Table
        head={["variable", "required", "notes"]}
        rows={[
          [<M key="1">MOOVE_API_KEY</M>, "yes", "The server exits without it."],
          [<M key="2">MOOVE_API_BASE_URL</M>, "no", "Only if your key names a different host."],
          [<M key="3">DATABASE_URL</M>, "no", "Postgres when set; SQLite otherwise. /health reports which."],
          [<M key="4">TOLLBOOTH_DB</M>, "no", "SQLite path. Defaults to /data/tollbooth.sqlite in the HTTP entrypoint."],
          [<M key="5">PORT</M>, "no", "8080."],
          [<M key="6">TOLLBOOTH_LANDING_URL</M>, "no", "Advertised by GET /."],
        ]}
      />
    </>
  );
}
