import React from "react";
import Link from "next/link";
import { Container } from "./container";
import { Badge } from "./badge";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";
import { DivideX } from "./divide";
import { HARNESS, WRITEUP, copyVariants, live, trials } from "@/content/measurements";

const pct = (r: number, n: number) => Math.round((r / n) * 100);

export const Results = () => (
  <Container className="border-divide border-x" as="section">
    <div id="results" className="scroll-mt-24" />
    <div className="flex flex-col items-center px-4 pt-16 md:px-8">
      <Badge text="What we measured" />
      <SectionHeading className="mt-4">
        {trials.scored} scored trials, sample sizes stated
      </SectionHeading>
      <SubHeading as="p" className="mx-auto mt-6 max-w-2xl">
        {trials.measuredOn}. {trials.client}, models {trials.models.join(" and ")}. Each
        trial is a blind two-turn conversation: a task that needs the paid tool, then
        &ldquo;I&rsquo;ve paid, please continue.&rdquo; Retry and token fidelity come from the
        server log, not from reading transcripts.
      </SubHeading>
    </div>

    {/* Primary table */}
    <div className="mt-12 overflow-x-auto px-4 md:px-8">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-divide border-y text-left text-xs tracking-wide text-gray-600 uppercase dark:text-neutral-400">
            <th className="py-3 pr-4 font-medium">Challenge shape</th>
            <th className="py-3 pr-4 text-right font-medium">n</th>
            <th className="py-3 pr-4 text-right font-medium">retried</th>
            <th className="py-3 pr-4 text-right font-medium">token exact</th>
            <th className="py-3 text-right font-medium">delivered</th>
          </tr>
        </thead>
        <tbody className="divide-divide divide-y font-mono tabular-nums">
          {trials.shapes.map((s) => {
            const zero = s.retried === 0;
            return (
              <tr key={s.shape} className={zero ? "text-gray-500 dark:text-neutral-500" : ""}>
                <td className="font-primary py-3 pr-4 text-charcoal-900 dark:text-white">
                  {s.shape}
                </td>
                <td className="py-3 pr-4 text-right">{s.n}</td>
                <td className="py-3 pr-4 text-right">{s.retried}</td>
                <td className="py-3 pr-4 text-right">{s.tokenExact}</td>
                <td className="py-3 text-right">
                  <span className={zero ? "" : "text-brand"}>
                    {s.delivered}
                  </span>{" "}
                  <span className="text-gray-600 dark:text-neutral-400">
                    ({pct(s.delivered, s.n)}%)
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* Three findings */}
    <div className="mt-12 grid grid-cols-1 gap-px bg-divide md:grid-cols-3">
      <Finding
        k={`${trials.tokenExactEqualsRetried.count}/${trials.tokenExactEqualsRetried.of}`}
        title="Token exact equalled retried"
        body="Whenever a model retried, it reproduced the handle perfectly. Transcription is never the failure mode; the decision to retry is the only thing that varies."
      />
      <Finding
        k={`${trials.tokenLeakedIntoVisibleText.count}/${trials.tokenLeakedIntoVisibleText.of}`}
        title="Handle in user-visible text"
        body="The model never printed the handle for the user. Reassuring, not proof — a longer conversation may behave differently."
      />
      <Finding
        k={`${trials.discarded}`}
        title="Trials discarded"
        body={`A first sweep used ${trials.discardedReason}. Re-run on a real checkout domain, the same copy scored ${trials.rerunOnRealDomain.retried}/${trials.rerunOnRealDomain.n}. The domain is load-bearing.`}
      />
    </div>

    {/* Elicitation */}
    <div className="border-divide border-t px-4 py-12 md:px-8">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <h3 className="text-lg font-medium text-charcoal-900 dark:text-white">
            Why elicitation scores zero — and why that is structural
          </h3>
          <p className="mt-3 text-sm text-gray-600 dark:text-neutral-300">
            MCP&rsquo;s URL-mode elicitation names payment as a use case. In{" "}
            {trials.shapes[2].n} trials it delivered nothing. The client recognises the{" "}
            <span className="font-mono">-32042</span> error, runs its own consent flow, and
            hands the model only the text on the right: no URL, no handle, no message.
          </p>
          <p className="mt-3 text-sm text-gray-600 dark:text-neutral-300">
            It is not a client gap. <span className="font-mono">-32042</span> is a JSON-RPC{" "}
            <em>error</em>, so it terminates the call and there is nowhere for a handle to
            ride. Even rendered perfectly, the model is left with nothing to retry with.
            Tollbooth encodes that in the type system: a renderer that cannot carry the
            handle cannot be a challenge&rsquo;s token bearer, and a test proves it.
          </p>
        </div>
        <blockquote className="rounded-xl border border-divide bg-gray-100 p-5 font-mono text-[13px] leading-relaxed text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200">
          &ldquo;{trials.elicitationToolResult}&rdquo;
          <footer className="font-primary mt-3 text-xs text-gray-600 not-italic dark:text-neutral-400">
            The complete <span className="font-mono">tool_result</span> the model received.
          </footer>
        </blockquote>
      </div>
    </div>

    {/* Copy variants, flagged */}
    <div className="border-divide border-t px-4 py-12 md:px-8">
      <div className="mx-auto max-w-5xl">
        <h3 className="text-lg font-medium text-charcoal-900 dark:text-white">
          Challenge copy: five variants, {copyVariants.perVariant} trials each
        </h3>
        <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-neutral-300">
          <strong className="text-charcoal-900 dark:text-white">Underpowered.</strong>{" "}
          {copyVariants.underpowered}
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-divide border-y text-left text-xs tracking-wide text-gray-600 uppercase dark:text-neutral-400">
                <th className="py-2 pr-4 font-medium">Variant</th>
                <th className="py-2 pr-4 font-medium">Intent</th>
                <th className="py-2 text-right font-medium">retried</th>
              </tr>
            </thead>
            <tbody className="divide-divide divide-y">
              {copyVariants.rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 font-mono">{r.id}</td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-neutral-300">
                    {r.intent}
                    {"confirmation" in r && r.confirmation && (
                      <span className="text-gray-500 dark:text-neutral-500">
                        {" "}
                        · plus {r.confirmation.retried}/{r.confirmation.n} on a confirmation run
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {r.retried}/{r.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <DivideX />

    {/* Live settlement: measured or marked pending, never estimated */}
    <div className="px-4 py-12 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-medium text-charcoal-900 dark:text-white">
            Live settlement
          </h3>
          <span
            className={
              "rounded-sm px-2 py-0.5 font-mono text-[11px] " +
              (live.measuredAt
                ? "bg-brand-soft text-brand dark:bg-teal-950 dark:text-teal-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300")
            }
          >
            {live.measuredAt ? `measured ${live.measuredAt}` : "pending — not yet measured"}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-neutral-300">
          One real payment through the deployed server, timed from link creation to{" "}
          <span className="font-mono">completed</span>. These fields are filled from that
          measurement and from nothing else.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-divide bg-divide sm:grid-cols-4">
          <Live label="Settlement chain" value={live.chain} />
          <Live label="Token" value={live.token} />
          <Live label="Asked / received" value={live.toAmount && live.receivedAmount ? `${live.toAmount} / ${live.receivedAmount}` : null} />
          <Live label="Creation → completed" value={live.settlementLatencySeconds !== null ? `${live.settlementLatencySeconds}s` : null} />
        </dl>
        <p className="mt-3 font-mono text-xs text-gray-600 dark:text-neutral-400">
          tx:{" "}
          {live.txHash && live.txUrl ? (
            <Link href={live.txUrl} className="text-brand underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
              {live.txHash}
            </Link>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">pending</span>
          )}
        </p>
      </div>
    </div>

    <div className="border-divide flex flex-wrap items-center justify-center gap-6 border-t px-4 py-8 text-sm md:px-8">
      <Link href={WRITEUP} target="_blank" rel="noreferrer" className="text-brand underline-offset-4 hover:underline">
        Full writeup and method →
      </Link>
      <Link href={HARNESS} target="_blank" rel="noreferrer" className="text-gray-600 underline-offset-4 hover:underline dark:text-neutral-300">
        The harness, runnable against the shipped renderers →
      </Link>
    </div>
  </Container>
);

const Finding = ({ k, title, body }: { k: string; title: string; body: string }) => (
  <div className="bg-white px-6 py-8 dark:bg-black">
    <div className="font-mono text-3xl font-medium tabular-nums text-charcoal-900 dark:text-white">
      {k}
    </div>
    <h3 className="mt-2 text-base font-medium text-charcoal-700 dark:text-neutral-100">
      {title}
    </h3>
    <p className="mt-2 text-sm text-gray-600 dark:text-neutral-300">{body}</p>
  </div>
);

const Live = ({ label, value }: { label: string; value: string | null }) => (
  <div className="bg-white px-4 py-4 dark:bg-black">
    <dt className="text-[11px] font-medium tracking-wide text-gray-600 uppercase dark:text-neutral-400">
      {label}
    </dt>
    <dd
      className={
        "mt-1 font-mono text-sm " +
        (value ? "text-charcoal-900 dark:text-white" : "text-amber-700 dark:text-amber-300")
      }
    >
      {value ?? "pending"}
    </dd>
  </div>
);
