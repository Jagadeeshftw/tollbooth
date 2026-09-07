"use client";
import React from "react";
import { Container } from "./container";
import { Badge } from "./badge";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";
import { IconBlock } from "./common/icon-block";
import { HorizontalLine } from "./common/horizontal-line";
import { VerticalLine } from "./common/vertical-line";
import { LogoSVG } from "./logo";

/*
 * The template's "how it works" was three rotating tabs with skeleton UIs. The
 * flow here is a diagram of the real loop, in the order it actually happens.
 * The lines are the template's own animated connectors.
 */
const steps = [
  {
    n: 1,
    who: "Agent",
    title: "Calls a paid tool",
    text: "No handle yet. An ordinary tools/call.",
    icon: <AgentIcon />,
  },
  {
    n: 2,
    who: "Tollbooth",
    title: "Returns a challenge",
    text: "isError: true, a checkout URL, and an opaque handle. Returned immediately — never blocks waiting for a human.",
    icon: <LogoSVG className="size-6" />,
  },
  {
    n: 3,
    who: "Human",
    title: "Pays on moove.xyz",
    text: "No account, no key. Any token, any chain Moove supports. Settles straight to the tool author's wallet.",
    icon: <PayIcon />,
  },
  {
    n: 4,
    who: "Agent",
    title: "Retries with the handle",
    text: "Same tool, same arguments, plus tollboothToken. Tollbooth polls settlement on that retry.",
    icon: <AgentIcon />,
  },
  {
    n: 5,
    who: "Tool",
    title: "Runs, one credit spent",
    text: "The handle now owns a credit pack. Every later call spends from it without another challenge.",
    icon: <CheckIcon />,
  },
];

export const Flow = () => (
  <Container className="border-divide border-x" as="section">
    <div id="how" className="scroll-mt-24" />
    <div className="flex flex-col items-center px-4 pt-16 pb-16 md:px-8">
      <Badge text="How it works" />
      <SectionHeading className="mt-4">Challenge, pay, retry</SectionHeading>
      <SubHeading as="p" className="mx-auto mt-6 max-w-xl">
        The loop rests on one assumption no protocol guarantees: that the agent comes
        back. That is the thing we measured.
      </SubHeading>

      {/* Desktop: five columns joined by the template's animated lines. */}
      <ol className="mt-16 hidden w-full grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] items-start lg:grid">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <Step {...s} />
            {i < steps.length - 1 && (
              <li aria-hidden className="flex h-12 items-center px-1">
                <HorizontalLine className="w-16 xl:w-24" />
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>

      {/* Mobile: stacked, joined by the vertical connector. */}
      <ol className="mt-12 flex w-full max-w-md flex-col items-center lg:hidden">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <Step {...s} />
            {i < steps.length - 1 && (
              <li aria-hidden className="flex justify-center">
                <VerticalLine />
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
    </div>
  </Container>
);

const Step = ({
  n,
  who,
  title,
  text,
  icon,
}: (typeof steps)[number]) => (
  <li className="flex flex-col items-center text-center">
    <IconBlock icon={icon} className="text-charcoal-900 dark:text-neutral-100" />
    <span className="mt-3 font-mono text-[11px] tracking-wide text-gray-600 uppercase dark:text-neutral-400">
      {n} · {who}
    </span>
    <h3 className="mt-1 text-base font-medium text-charcoal-700 dark:text-neutral-100">
      {title}
    </h3>
    <p className="mt-1 max-w-[16rem] text-sm text-gray-600 dark:text-neutral-300">{text}</p>
  </li>
);

function AgentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
    </svg>
  );
}
function PayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 14h3" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}
