import React from "react";
import Link from "next/link";
import { Container } from "./container";
import { Badge } from "./badge";
import { SectionHeading } from "./section-heading";
import { SubHeading } from "./subheading";
import { QUICKSTART, REPO, SERVER } from "@/content/measurements";

const RUN = `git clone ${REPO}
cd tollbooth
npm install
npm run build

export MOOVE_API_KEY=mk_live_...
# Only if your key names a different host. Do not guess it.
# export MOOVE_API_BASE_URL=https://api.moove.xyz

node examples/research-tools/dist/stdio.js`;

const TOOL = `server.paidTool(
  'fetch_readable',
  'Fetch a web page and return its readable text.',
  { sku: 'research', cost: 1 },   // an expensive tool can cost more
  { url: z.string() },
  { readOnlyHint: true },
  async (args) => readable(String(args.url))
);`;

const CLIENT = `{
  "mcpServers": {
    "tollbooth-research": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${SERVER}/mcp"]
    }
  }
}`;

export const Quickstart = () => (
  <Container className="border-divide border-x px-4 py-20 md:px-8" as="section">
    <div id="quickstart" className="scroll-mt-24" />
    <div className="flex flex-col items-center">
      <Badge text="Quickstart" />
      <SectionHeading className="mt-4">A paid tool in under ten minutes</SectionHeading>
      <SubHeading as="p" className="mx-auto mt-6 max-w-xl">
        You need Node 20, a Moove account with a handle and a default wallet, and an API
        key. Unpaid calls never reach your handler.
      </SubHeading>
    </div>

    <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Code title="1 · run the reference server" code={RUN} />
      <Code title="2 · make a tool paid" code={TOOL} />
      <Code
        title="3 · or point a client at the deployed one"
        code={CLIENT}
        note="Nothing secret goes in this file. The deployed server holds the keys."
        wide
      />
    </div>

    <p className="mt-6 text-center text-sm text-gray-600 dark:text-neutral-300">
      Full quickstart, with the three tools and the hardening notes:{" "}
      <Link href={QUICKSTART} target="_blank" rel="noreferrer" className="text-brand underline-offset-4 hover:underline">
        examples/research-tools →
      </Link>
    </p>
  </Container>
);

const Code = ({
  title,
  code,
  note,
  wide,
}: {
  title: string;
  code: string;
  note?: string;
  wide?: boolean;
}) => (
  <div className={"overflow-hidden rounded-xl border border-divide bg-gray-100 dark:bg-neutral-900 " + (wide ? "lg:col-span-2" : "")}>
    <div className="border-divide border-b px-4 py-2 font-mono text-xs text-gray-600 dark:text-neutral-400">
      {title}
    </div>
    <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-neutral-800 dark:text-neutral-200">
      {code}
    </pre>
    {note && (
      <div className="border-divide border-t px-4 py-2 text-xs text-gray-600 dark:text-neutral-400">
        {note}
      </div>
    )}
  </div>
);
