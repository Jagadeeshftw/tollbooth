"use client";
import React from "react";
import Link from "next/link";
import { Container } from "./container";
import { Heading } from "./heading";
import { SubHeading } from "./subheading";
import { Button } from "./button";
import { Badge } from "./badge";
import { REPO, WRITEUP, trials } from "@/content/measurements";

const structured = trials.shapes[0];
const text = trials.shapes[1];
const elicitation = trials.shapes[2];
const pct = (r: number, n: number) => Math.round((r / n) * 100);

export const Hero = () => (
  <Container className="border-divide flex flex-col items-center justify-center border-x px-4 pt-10 pb-10 md:pt-32 md:pb-20">
    <Badge text={`${trials.scored} blind trials · ${trials.measuredOn}`} />
    <Heading className="mt-4 max-w-4xl">
      Agents come back after a payment challenge.{" "}
      <span className="text-brand">We measured it.</span>
    </Heading>

    <SubHeading as="p" className="mx-auto mt-6 max-w-2xl text-base lg:text-lg">
      In {trials.scored} blind trials, agents retried the tool after the user paid{" "}
      <strong className="text-charcoal-900 dark:text-white">
        {pct(text.retried, text.n)}–{pct(structured.retried, structured.n)}%
      </strong>{" "}
      of the time with structured and text challenges, and{" "}
      <strong className="text-charcoal-900 dark:text-white">
        {pct(elicitation.retried, elicitation.n)}%
      </strong>{" "}
      with URL-mode elicitation. Tollbooth is a paywall layer for MCP servers built on
      that measurement.
    </SubHeading>

    <div className="mt-8 flex items-center gap-4">
      <Button as={Link} href={WRITEUP} target="_blank" rel="noreferrer">
        Read the measurement
      </Button>
      <Button variant="secondary" as={Link} href={REPO} target="_blank" rel="noreferrer">
        Get the code
      </Button>
    </div>

    <dl className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-xl border border-divide bg-divide text-left sm:grid-cols-3">
      <Stat
        label="structured + text"
        value={`${structured.retried}/${structured.n}`}
        note={`${pct(structured.retried, structured.n)}% retried`}
      />
      <Stat
        label="text only"
        value={`${text.retried}/${text.n}`}
        note={`${pct(text.retried, text.n)}% retried`}
      />
      <Stat
        label="URL-mode elicitation"
        value={`${elicitation.retried}/${elicitation.n}`}
        note={`${pct(elicitation.retried, elicitation.n)}% retried`}
        muted
      />
    </dl>
    <p className="mt-3 text-xs text-gray-600 dark:text-neutral-400">
      {trials.client}, models {trials.models.join(" and ")}. The subject is blind: it sees a
      task, not an experiment.
    </p>
  </Container>
);

const Stat = ({
  label,
  value,
  note,
  muted,
}: {
  label: string;
  value: string;
  note: string;
  muted?: boolean;
}) => (
  <div className="bg-white px-5 py-4 dark:bg-black">
    <dt className="text-xs font-medium tracking-wide text-gray-600 uppercase dark:text-neutral-400">
      {label}
    </dt>
    <dd
      className={
        "font-mono mt-1 text-3xl font-medium tabular-nums " +
        (muted ? "text-gray-500 dark:text-neutral-500" : "text-charcoal-900 dark:text-white")
      }
    >
      {value}
    </dd>
    <dd className="mt-0.5 text-sm text-gray-600 dark:text-neutral-400">{note}</dd>
  </div>
);
