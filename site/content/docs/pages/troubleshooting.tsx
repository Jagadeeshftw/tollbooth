import { A, H2, Mono, P, Table } from "@/components/docs/prose";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "troubleshooting",
  title: "Troubleshooting",
  summary: "The errors you will actually see, what each means, and which are worth retrying.",
  section: "Operating",
  toc: [
    { id: "moove", text: "Moove error codes" },
    { id: "server", text: "Server and store errors" },
    { id: "loop", text: "The loop does not close" },
  ],
};

const M = ({ children }: { children: string }) => <Mono>{children}</Mono>;

export default function Page() {
  return (
    <>
      <H2 id="moove">Moove error codes</H2>
      <P>
        Every documented code maps to a typed error carrying its retry semantics. The rule, from
        the API&rsquo;s own guidance: only 429 and 5xx are worth retrying. Retrying a 4xx cannot
        succeed, still counts against the rate limit, and a retry loop against a revoked key
        looks like an attack.
      </P>
      <Table
        head={["status · code", "typed as", "retry", "what to do"]}
        rows={[
          [<M key="1">401 UNAUTHENTICATED</M>, <M key="a">MooveAuthError</M>, "never", "No X-API-Key on a route that needs one. Check the environment."],
          [<M key="2">401 INVALID_API_KEY</M>, <M key="b">MooveAuthError</M>, "never", "Unknown, revoked or deactivated. Create a new key."],
          [<M key="3">401 EXPIRED_API_KEY</M>, <M key="c">MooveAuthError</M>, "never", "Past its expiry. Create a new key."],
          [<M key="4">403 INSUFFICIENT_API_SCOPE</M>, <M key="d">MooveScopeError</M>, "never", "Scopes are fixed at creation. Recreate the key with the Receive agent."],
          [<M key="5">404 CANNOT_FIND_PAYMENT_LINK</M>, <M key="e">MooveNotFoundError</M>, "never", "No link with that id. A real answer, not an auth failure — the public read does not fall back on it."],
          [<M key="6">409 PAYMENT_LINK_ACCOUNT_NOT_READY</M>, <M key="f">MooveAccountNotReadyError</M>, "never", <>Set a handle and a default wallet. See <A href="/docs/moove-setup#409">Moove setup</A>.</>],
          [<M key="7">422 INVALID_PAYMENT_LINK_AMOUNT</M>, <M key="g">MooveAmountError</M>, "never", "More decimal places than the settlement token has (six for USDC)."],
          [<M key="8">429 RATE_LIMIT_EXCEEDED</M>, <M key="h">MooveRateLimitError</M>, "backoff", "No Retry-After is sent. The client backs off with jitter and halves its rate."],
          [<M key="9">500 CANNOT_CREATE_PAYMENT_LINK</M>, <M key="i">MooveServerError</M>, "backoff", "Bounded retry, then surface."],
        ]}
      />

      <H2 id="server">Server and store errors</H2>
      <Table
        head={["symptom", "cause", "fix"]}
        rows={[
          [<M key="1">Bad Request: Server not initialized</M>, "A transport per request while asking for session ids: the follow-up request lands on a transport that never saw initialize.", "Serve MCP statelessly — a fresh server and transport per request, no session id. The reference HTTP entrypoint does this."],
          [<M key="2">SQLITE_BUSY</M> , "Several processes running the schema DDL on one file at once.", "Construction retries briefly. If it persists, one process should own the file."],
          [<M key="3">AmbiguousCommitError</M>, "A Postgres COMMIT failed at the connection level. It may have applied.", "Deliberately not retried: retrying could spend the same credit twice. Re-read the balance before acting."],
          [<M key="4">MemoryEntitlementStore holds paid entitlements in memory</M>, "The reference store used outside tests.", "Use SQLite or Postgres, or acknowledgeEphemeral: true if you really mean it."],
          [<M key="5">paidTool references sku …, which the provider does not sell</M>, "The price is not in the provider's list.", "Register the price before the tool."],
          [<M key="6">Too many requests. Wait Ns</M>, "The per-handle rate limit on the reference server.", "Separate from the credit balance. It clears on its own."],
          [<M key="7">[tollbooth] underpaid</M>, "A settlement below the 10% floor. Nothing was granted.", <>Only a person can resolve it. See <A href="/docs/underpayment">underpayment</A>.</>],
        ]}
      />

      <H2 id="loop">The loop does not close</H2>
      <Table
        head={["what you see", "likely cause"]}
        rows={[
          ["The challenge appears, the user pays, the agent answers from its own knowledge instead of retrying", "The one failure mode measured. Copy variant v3 guards against it; an untrustworthy-looking checkout domain makes it worse."],
          [<>The agent reports <M>URL elicitation was canceled</M></>, "A server is emitting the elicitation shape. Tollbooth never does; if you enabled a renderer by allow-list, remove it."],
          ["The retry is challenged again, forever", "Either the payment has not settled, or the charge expired (60 minutes). Check the charge's status; a new challenge opens a new link."],
          ["A retry says the handle is unknown", "Lapsed after 30 days unused, or presented by a different principal than it was bound to. A fresh challenge is issued rather than a hard failure."],
        ]}
      />
    </>
  );
}
