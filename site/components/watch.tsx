import React from "react";

import { Container } from "./container";
import { Explainer } from "./explainer";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";

/**
 * The explainer, placed directly after the measurement: someone who has just
 * read the numbers is the person most likely to want the whole argument.
 *
 * It sits behind a click. The film is a few megabytes and most visitors will
 * not watch it, so the page costs them a still until they ask.
 */
export const Watch = () => (
  <Container className="border-divide relative overflow-hidden border-x px-4 py-20 md:px-8" as="section">
    <div id="watch" className="scroll-mt-24" />
    <SectionHeading>The whole thing, in two and a half minutes</SectionHeading>
    <SubHeading className="mx-auto mt-4 max-w-2xl text-center">
      The measurement, the flow, and what is built. Silent — every figure on screen comes from
      the same file this page reads.
    </SubHeading>
    <div className="mx-auto mt-10 max-w-3xl">
      <Explainer />
    </div>
  </Container>
);
