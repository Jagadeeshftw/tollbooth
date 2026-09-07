import React from "react";
import Link from "next/link";
import { Container } from "./container";
import { Badge } from "./badge";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";
import { MOOVE, live, mooveDocumented } from "@/content/measurements";

/*
 * The template's "benefits" grid had six invented benefits around an animated
 * dashboard. This keeps the grid and drops everything we cannot stand behind.
 * Each card says whether its claim is Moove's documentation or our measurement.
 */
const cards = [
  {
    title: "No account. No signup. No KYC.",
    body: "The person paying opens a checkout link and pays. Moove's read endpoint is public precisely because the payer has no account and no key.",
    basis: "Moove documentation",
  },
  {
    title: `Any token, any of ${mooveDocumented.chains} chains`,
    body: "Moove routes and swaps to the tool author's settlement token. The payer chooses what they hold.",
    basis: `Moove's own count (${mooveDocumented.chains} chains)`,
  },
  {
    title: "The tool author receives the full amount",
    body: `For a payment link, ${mooveDocumented.linkDeliversFullAmount}. The ${mooveDocumented.protocolFeeCrossChain} protocol fee is the payer's; same-chain, same-token is ${mooveDocumented.sameChainSameToken}.`,
    basis: "Moove fee schedule",
    live: true,
  },
  {
    title: "Settles straight to your wallet",
    body: "Tollbooth never holds anyone's revenue. The payment API has no way to send money onward, so there is nothing to hold and nothing to trust us with.",
    basis: "Design property",
  },
];

export const Payers = () => (
  <Container className="border-divide relative overflow-hidden border-x px-4 py-20 md:px-8" as="section">
    <div id="payers" className="scroll-mt-24" />
    <div className="relative flex flex-col items-center">
      <Badge text="For the person paying" />
      <SectionHeading className="mt-4">The payer side is different</SectionHeading>
      <SubHeading as="p" className="mx-auto mt-6 max-w-xl">
        Most paid-MCP work assumes the agent holds a wallet. Tollbooth assumes a human
        does, and asks as little of them as a checkout link can.
      </SubHeading>
    </div>
    <div className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2">
      {cards.map((c) => (
        <div
          key={c.title}
          className="relative rounded-lg bg-gray-50 p-5 transition duration-200 dark:bg-neutral-800"
        >
          <h3 className="text-lg font-medium text-charcoal-900 dark:text-white">{c.title}</h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-neutral-300">{c.body}</p>
          <p className="mt-4 font-mono text-[11px] text-gray-500 dark:text-neutral-500">
            basis: {c.basis}
            {c.live && (
              <>
                {" · "}
                {live.receivedAmount && live.toAmount ? (
                  <span className="text-brand">
                    measured: asked {live.toAmount}, received {live.receivedAmount}
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">
                    measured confirmation pending
                  </span>
                )}
              </>
            )}
          </p>
        </div>
      ))}
    </div>
    <p className="mt-6 text-center text-xs text-gray-600 dark:text-neutral-400">
      Payments run on{" "}
      <Link href={MOOVE} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
        Moove
      </Link>
      . A checkout URL identifies the tool author — the read is public by design — so it
      is fine to hand to the person paying and not fine to paste somewhere public.
    </p>
  </Container>
);
