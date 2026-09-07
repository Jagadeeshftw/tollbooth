import { A, Basis, Code, H2, Mono, Note, P, Strong, Table, UL } from "@/components/docs/prose";
import { POSTGRES } from "@/content/snippets";
import type { DocMeta } from "../registry";

export const meta: DocMeta = {
  slug: "stores",
  title: "Stores",
  summary: "Memory, SQLite and Postgres, and what the conformance suite guarantees of all three.",
  section: "Model",
  toc: [
    { id: "choose", text: "Choosing one" },
    { id: "memory", text: "Memory" },
    { id: "sqlite", text: "SQLite" },
    { id: "postgres", text: "Postgres" },
    { id: "conformance", text: "What the conformance suite guarantees" },
    { id: "neon", text: "What the Neon run showed" },
  ],
};

export default function Page() {
  return (
    <>
      <H2 id="choose">Choosing one</H2>
      <Table
        head={["store", "durable", "use it when"]}
        rows={[
          [<Mono key="1">MemoryEntitlementStore</Mono>, "no", "Tests, and reading the contract. Warns if used anywhere else."],
          [<Mono key="2">SqliteEntitlementStore</Mono>, "yes", "The zero-config default. One machine, a file on disk."],
          [<Mono key="3">PostgresEntitlementStore</Mono>, "yes", "Deployment. A container filesystem does not survive a redeploy; paid credits must."],
        ]}
      />

      <H2 id="memory">Memory</H2>
      <P>
        The reference implementation: correct, and deliberately not durable. <Mono>consume</Mono>{" "}
        is a real compare-and-swap on the record&rsquo;s version — it snapshots, yields, and
        swaps only if nothing moved underneath. It exposes a test seam that forces the
        interleaving a naive read-then-write would lose to, and a negative control proves the
        seam has teeth. Construction warns unless <Mono>NODE_ENV=test</Mono> or{" "}
        <Mono>acknowledgeEphemeral: true</Mono>.
      </P>

      <H2 id="sqlite">SQLite</H2>
      <P>
        <Mono>better-sqlite3</Mono>, WAL mode. <Mono>consume</Mono> runs in an{" "}
        <Mono>IMMEDIATE</Mono> transaction <em>and</em> keeps the version guard, so it holds
        both against concurrent calls in one process and against a second process on its own
        connection. <Mono>claimSettlement</Mono> is a primary-key insert, so exactly-once
        survives a restart.
      </P>
      <P>
        One thing found in CI: several processes opening the same file all run the schema
        DDL, and under WAL that can return <Mono>SQLITE_BUSY</Mono> even with a busy timeout.
        Construction now retries briefly. Postgres handles the same case with an advisory lock.
      </P>

      <H2 id="postgres">Postgres</H2>
      <Code title="setup">{POSTGRES}</Code>
      <UL>
        <li>
          <Strong>Row lock plus version guard.</Strong> <Mono>SELECT … FOR UPDATE</Mono> serialises
          competing spenders; the version guard keeps the semantics identical to SQLite from either
          direction.
        </li>
        <li>
          <Strong>Migrations under an advisory lock</Strong>, because two instances booting
          together after a deploy is the normal case.
        </li>
        <li>
          <Strong>Neon idle suspension.</Strong> Connection-level failures (<Mono>57P03</Mono>,{" "}
          <Mono>08006</Mono>, <Mono>ECONNRESET</Mono>, &ldquo;Connection terminated&rdquo;) retry
          with jittered backoff. Errors the request itself caused never do.
        </li>
        <li>
          <Strong>A failed <Mono>COMMIT</Mono> is never retried.</Strong> It may have applied
          before the acknowledgement was lost, and retrying would spend the same credit twice.
          It surfaces as <Mono>AmbiguousCommitError</Mono> instead.
        </li>
      </UL>

      <H2 id="conformance">What the conformance suite guarantees</H2>
      <P>
        The contracts that lose money when they are wrong are written once, in{" "}
        <Mono>@tollbooth/store-conformance</Mono>, and run against every backend. A store that
        passes is safe to put in front of payments; one that does not is not, however well its
        own tests read. Seven groups:
      </P>
      <UL>
        <li>consume across the three pricing units, including all-or-nothing cost and the three failure reasons</li>
        <li>consume is atomic: 40 concurrent calls against 10 credits grant exactly 10; twelve <em>separate processes</em> against 4 credits grant exactly 4</li>
        <li>claimSettlement is exactly-once, including under 32 concurrent claimants</li>
        <li>charge bookkeeping: patches, pending lists, expiry sweeps</li>
        <li>subject handles round-trip and slide without rewriting creation time</li>
        <li>the three underpayment zones persist correctly</li>
        <li>survives a restart: balances, charges, handles, and the exactly-once claim</li>
      </UL>
      <P>
        Memory declares no <Mono>reopen</Mono>, so its durability tests are <em>skipped, not
        faked</em>. When the suite was extracted, memory and SQLite passed it unchanged.
        <Basis kind="measured" />
      </P>
      <Note kind="warn" title="The suite truncates every table on each create">
        It refuses to fall back to <Mono>DATABASE_URL</Mono>. Point it at a database on purpose
        with <Mono>TOLLBOOTH_TEST_POSTGRES_URL</Mono>, never at one holding paid entitlements.
      </Note>

      <H2 id="neon">What the Neon run showed</H2>
      <P>
        All seven groups pass against a real Neon pooled endpoint, including the twelve-process
        contention test, with no behavioural difference from Postgres 15 or 16.
        <Basis kind="measured" detail="2026-09-07" /> The only difference was latency from a
        laptop to <Mono>us-east-1</Mono> — seconds per test rather than milliseconds — which is
        why deployment sits in the same region as the database. See{" "}
        <A href="/docs/troubleshooting">troubleshooting</A> for the errors each store raises.
      </P>
    </>
  );
}
