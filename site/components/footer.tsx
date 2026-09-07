import Link from "next/link";
import { Container } from "./container";
import { Logo } from "./logo";
import { SubHeading } from "./subheading";
import { HARNESS, MOOVE, QUICKSTART, REPO, SERVER, WRITEUP } from "@/content/measurements";

/*
 * The template footer had product, company and legal columns, a newsletter box
 * and social links. None of those exist. This links to the things that do.
 */
const links = [
  { title: "Repository", href: REPO },
  { title: "The measurement", href: WRITEUP },
  { title: "Harness", href: HARNESS },
  { title: "Quickstart", href: QUICKSTART },
  { title: "Deployed server", href: SERVER },
  { title: "Moove", href: MOOVE },
];

export const Footer = () => (
  <Container>
    <div className="flex flex-col gap-8 px-4 py-16 md:flex-row md:items-start md:justify-between">
      <div className="max-w-md">
        <Logo />
        <SubHeading as="p" className="mt-4 text-left">
          A paywall layer for MCP servers. An agent calls a paid tool, a human pays, the
          agent retries. Every number on this page is one we measured, at the precision
          we measured it.
        </SubHeading>
      </div>
      <nav className="grid grid-cols-2 gap-x-10 gap-y-2" aria-label="Footer">
        {links.map((l) => (
          <Link
            key={l.title}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="text-footer-link text-sm font-medium underline-offset-4 hover:underline"
          >
            {l.title}
          </Link>
        ))}
      </nav>
    </div>
    <div className="border-divide flex flex-col items-center justify-between gap-2 border-t px-4 py-6 md:flex-row">
      <p className="text-footer-link text-sm">© 2026 Jagadeesh B · MIT licence</p>
      <p className="text-footer-link font-mono text-xs">pre-release · nothing on npm yet</p>
    </div>
  </Container>
);
