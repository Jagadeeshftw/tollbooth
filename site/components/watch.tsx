import React from "react";

import { Container } from "./container";
import { Explainer } from "./explainer";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";

/**
 * The explainer, placed directly after the measurement: someone who has just
 * read the numbers is the person most likely to want the whole argument.
 *
 * It sits behind a click. An embedded player would cost every visitor a
 * megabyte of Google scripts whether or not they watch; a poster costs them a
 * still until they ask for it.
 */
export const Watch = () => (
  <Container className="border-divide relative overflow-hidden border-x px-4 py-20 md:px-8" as="section">
    <div id="watch" className="scroll-mt-24" />
    <SectionHeading>The whole thing, in under two minutes</SectionHeading>
    <SubHeading className="mx-auto mt-4 max-w-2xl text-center">
      The measurement, the flow, and what is built. Every figure on screen comes from the same
      file this page reads.
    </SubHeading>
    <div className="mx-auto mt-10 max-w-3xl">
      <Explainer />
    </div>
  </Container>
);
