import { A, Basis, Code, H2, Mono, Note, P, Strong, Table, UL } from "@/components/docs/prose";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "rate-limits",
  title: "Rate limits and the polling design",
  summary: "What the live API actually does, and how polling is shaped so it never matters.",
  section: "Payments",
  toc: [
    { id: "measured", text: "What we measured" },
    { id: "design", text: "The polling design" },
    { id: "limiter", text: "The limiter, and why its defaults stay low" },
    { id: "maxusage", text: "maxUsage: N" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="measured">What we measured</H2>
      <P>
        Moove documents that requests are limited per key and per IP, whichever is reached first,
        and publishes no numbers. So we measured, 2026-09-07, against production with a real key.
        <Basis kind="measured" />
      </P>
      <Table
        head={["question", "result", "how"]}
        rows={[
          ["Keyless by-id read on a real id", <Strong key="1">Works. Full object returned.</Strong>, "Created a link with a key, read it with no X-API-Key header."],
          ["Does that route share the authenticated bucket?", <Strong key="2">No — separate buckets.</Strong>, "300 public reads at 24 req/s: zero 429. The authenticated route tripped at ~141 in the same window."],
          ["Per-key limit", <><Strong>Concurrency-sensitive, not a fixed quota.</Strong> 429 after ~141 requests at 30 concurrent (~27 req/s). Paced load at 5, 10 and 20 req/s ran clean. Recovery immediate.</>, "Burst ramp to first 429, a paced sweep, a recovery poll."],
          ["Retry-After or RateLimit-* on a 429?", <Strong key="3">Neither. No rate-limit headers of any kind.</Strong>, "Captured every header on an induced 429: Date, Content-Type, Content-Length, Connection, server."],
          ["Expiry → inactive", <Strong key="4">Automatic, lazily.</Strong>, "A 90-second link read active at 100s and inactive at 120s."],
        ]}
      />

      <H2 id="design">The polling design</H2>
      <UL>
        <li>
          <Strong>Never inline.</Strong> A challenge returns immediately; nothing waits on a human
          inside a tool call.
        </li>
        <li>
          <Strong>Poll the public by-id read, not the authenticated list.</Strong> It costs
          nothing against the key budget, and Moove&rsquo;s own docs say the list endpoint is for
          reconciliation, not for watching one link.
        </li>
        <li>
          <Strong>Demand-driven first.</Strong> The agent&rsquo;s retry is the trigger. A floor of
          2 seconds between polls of the same charge means a tight retry loop cannot become a
          poll loop — a test asserts ten rapid retries produce one read.
        </li>
        <li>
          <Strong>Terminal is terminal.</Strong> <Mono>completed</Mono> and{" "}
          <Mono>inactive</Mono> are cached forever and never re-fetched.
        </li>
      </UL>
      <P>The optional background reconciler, when it does run, follows a bounded jittered schedule:</P>
      <Code title="reconciler schedule — POLL_SCHEDULE_MS and POLL_JITTER in packages/moove/src/poller.ts">{`3s, 6s, 12s, 24s, 48s, then every 60s, ±30% jitter,
until the charge expires (60 minutes by default)`}</Code>
      <P>
        Charges older than the expiry are swept to <Mono>abandoned</Mono> without an API call.
        The 401 fallback to an authenticated read exists because the public route is deliberately
        absent from the published OpenAPI document and could change without a schema diff.
      </P>

      <H2 id="limiter">The limiter, and why its defaults stay low</H2>
      <P>
        Two independent adaptive token buckets — keyed at 2 req/s, public at 8 req/s —
        additive increase on sustained success, halve on an observed 429. With no headers to
        read, backoff has to be blind, and this converges on the real limit without knowing it.
      </P>
      <Note kind="info" title="The measured headroom did not change the defaults">
        This is a library other people run from their own infrastructure, against their own
        keys, sharing an IP with whatever else they run. A ceiling measured once, from one
        machine, on one account, is not a budget the library should spend on someone else&rsquo;s
        behalf. It adapts upward if the headroom is really there.
      </Note>

      <H2 id="maxusage">maxUsage: N</H2>
      <Note kind="unresolved">
        Whether a multi-use link reports partial progress is unresolved. The object exposes only{" "}
        <Mono>maxUsage</Mono>, <Mono>status</Mono> and <Mono>receivedAmount</Mono> — no usage
        counter — so there is no field that could show <em>k of N</em>, and whether{" "}
        <Mono>status</Mono> flips at the Nth payment or earlier needs a real payment against a
        multi-use link, which has not been done.
      </Note>
      <P>
        It does not bear on the design. Tollbooth only ever issues <Mono>maxUsage: 1</Mono>{" "}
        links — one per charge — because Moove exposes nothing that identifies a payer, so a
        link shared between two buyers would be unattributable whatever a counter said. See{" "}
        <A href="/docs/link-ids">what a link id reveals</A>.
      </P>
    </>
  );
}
