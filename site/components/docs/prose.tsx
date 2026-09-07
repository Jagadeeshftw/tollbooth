import React from "react";
import Link from "next/link";
import { CopyButton } from "./copy-button";

/*
 * The handful of primitives every docs page is built from. Keeping them here
 * is what lets fourteen pages read as one document.
 */

export const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h2
    id={id}
    className="group mt-14 scroll-mt-28 border-t border-divide pt-8 text-2xl font-medium tracking-tight text-charcoal-900 first:mt-0 first:border-t-0 first:pt-0 dark:text-white"
  >
    <a href={`#${id}`} className="no-underline">
      {children}
      <span className="ml-2 text-gray-500 opacity-0 transition group-hover:opacity-100" aria-hidden>
        #
      </span>
    </a>
  </h2>
);

export const H3 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h3 id={id} className="group mt-8 scroll-mt-28 text-lg font-medium text-charcoal-800 dark:text-neutral-100">
    <a href={`#${id}`} className="no-underline">
      {children}
      <span className="ml-2 text-gray-500 opacity-0 transition group-hover:opacity-100" aria-hidden>
        #
      </span>
    </a>
  </h3>
);

export const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-4 text-[15px] leading-7 text-neutral-700 dark:text-neutral-300">{children}</p>
);

export const UL = ({ children }: { children: React.ReactNode }) => (
  <ul className="mt-4 list-disc space-y-2 pl-6 text-[15px] leading-7 text-neutral-700 marker:text-gray-500 dark:text-neutral-300">
    {children}
  </ul>
);

export const OL = ({ children }: { children: React.ReactNode }) => (
  <ol className="mt-4 list-decimal space-y-2 pl-6 text-[15px] leading-7 text-neutral-700 marker:text-gray-500 dark:text-neutral-300">
    {children}
  </ol>
);

export const Strong = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-medium text-charcoal-900 dark:text-white">{children}</strong>
);

export const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[13px] text-charcoal-900 dark:bg-neutral-800 dark:text-neutral-100">
    {children}
  </code>
);

export const A = ({ href, children }: { href: string; children: React.ReactNode }) => {
  const external = /^https?:/.test(href);
  return (
    <Link
      href={href}
      className="text-brand underline-offset-4 hover:underline"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </Link>
  );
};

export const Code = ({ title, children }: { title?: string; children: string }) => (
  <div className="mt-4 overflow-hidden rounded-xl border border-divide bg-gray-100 dark:bg-neutral-900">
    <div className="flex items-center justify-between border-b border-divide px-3 py-1.5">
      <span className="font-mono text-[11px] text-gray-600 dark:text-neutral-400">{title ?? ""}</span>
      <CopyButton text={children} />
    </div>
    <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-neutral-800 dark:text-neutral-200">
      {children}
    </pre>
  </div>
);

export const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="mt-4 overflow-x-auto rounded-xl border border-divide">
    <table className="w-full min-w-[32rem] border-collapse text-sm">
      <thead>
        <tr className="border-b border-divide bg-gray-100 text-left text-[11px] tracking-wide text-gray-600 uppercase dark:bg-neutral-900 dark:text-neutral-400">
          {head.map((h) => (
            <th key={h} className="px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-divide">
        {rows.map((r, i) => (
          <tr key={i} className="align-top">
            {r.map((c, j) => (
              <td key={j} className="px-3 py-2 text-neutral-700 dark:text-neutral-300">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type Basis = "measured" | "documented" | "design" | "unresolved";
const basisStyle: Record<Basis, string> = {
  measured: "bg-brand-soft text-brand dark:bg-teal-950 dark:text-teal-300",
  documented: "bg-gray-200 text-charcoal-700 dark:bg-neutral-800 dark:text-neutral-200",
  design: "bg-gray-200 text-charcoal-700 dark:bg-neutral-800 dark:text-neutral-200",
  unresolved: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};
const basisLabel: Record<Basis, string> = {
  measured: "measured",
  documented: "Moove documentation",
  design: "design property",
  unresolved: "unresolved",
};

/** Says where a claim comes from. Every number on a page should sit near one. */
export const Basis = ({ kind, detail }: { kind: Basis; detail?: string }) => (
  <span className={"ml-1 inline-block rounded-sm px-1.5 py-0.5 align-middle font-mono text-[10px] " + basisStyle[kind]}>
    {basisLabel[kind]}
    {detail ? ` · ${detail}` : ""}
  </span>
);

export const Note = ({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn" | "unresolved";
  title?: string;
  children: React.ReactNode;
}) => {
  const styles = {
    info: "border-divide bg-gray-100 dark:bg-neutral-900",
    warn: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
    unresolved: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  }[kind];
  const label = { info: null, warn: "Warning", unresolved: "Unresolved" }[kind];
  return (
    <div className={"mt-4 rounded-xl border p-4 text-[14px] leading-6 text-neutral-700 dark:text-neutral-300 " + styles}>
      {(label || title) && (
        <div className="mb-1 font-medium text-charcoal-900 dark:text-white">
          {label && <span className="mr-2 font-mono text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">{label}</span>}
          {title}
        </div>
      )}
      {children}
    </div>
  );
};
