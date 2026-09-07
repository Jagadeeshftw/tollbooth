import { DivideX } from "@/components/divide";
import { Hero } from "@/components/hero";
import { Transcript } from "@/components/transcript";
import { Flow } from "@/components/flow";
import { Results } from "@/components/results";
import { Payers } from "@/components/payers";
import { Quickstart } from "@/components/quickstart";

/*
 * Sections follow the template's bones — bordered container, hairline dividers,
 * badge / heading / subheading rhythm. What is missing is deliberate: no
 * pricing tiers, no testimonials, no logo cloud, no client list, no FAQ. We have
 * no honest content for any of them, so they are not here.
 */
export default function Home() {
  return (
    <main>
      <DivideX />
      <Hero />
      <DivideX />
      <Transcript />
      <DivideX />
      <Flow />
      <DivideX />
      <Results />
      <DivideX />
      <Payers />
      <DivideX />
      <Quickstart />
      <DivideX />
    </main>
  );
}
