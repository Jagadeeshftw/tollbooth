"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocMeta } from "@/content/docs/registry";

/*
 * Persistent on desktop, a drawer on phones. Search is a client-side filter
 * over titles, summaries and section headings — cheap, and enough for fourteen
 * pages. It deliberately does not index body text.
 */
export const Sidebar = ({ pages }: { pages: DocMeta[] }) => {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (p: DocMeta) =>
      !needle ||
      p.title.toLowerCase().includes(needle) ||
      p.summary.toLowerCase().includes(needle) ||
      p.toc.some((t) => t.text.toLowerCase().includes(needle));
    const out = new Map<string, DocMeta[]>();
    for (const p of pages) {
      if (!hit(p)) continue;
      out.set(p.section, [...(out.get(p.section) ?? []), p]);
    }
    return out;
  }, [pages, q]);

  const list = (
    <nav aria-label="Documentation" className="text-sm">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search pages…"
        className="mb-4 w-full rounded-lg border border-divide bg-white px-3 py-1.5 text-sm outline-none placeholder:text-gray-500 focus:border-brand dark:bg-neutral-950"
      />
      {[...groups.entries()].map(([section, items]) => (
        <div key={section} className="mb-5">
          <div className="mb-1 font-mono text-[11px] tracking-wide text-gray-600 uppercase dark:text-neutral-400">
            {section}
          </div>
          <ul className="space-y-0.5">
            {items.map((p) => {
              const active = pathname === `/docs/${p.slug}`;
              return (
                <li key={p.slug}>
                  <Link
                    href={`/docs/${p.slug}`}
                    onClick={() => setOpen(false)}
                    className={
                      "block rounded-md px-2 py-1 transition " +
                      (active
                        ? "bg-brand-soft font-medium text-brand dark:bg-teal-950 dark:text-teal-300"
                        : "text-neutral-700 hover:bg-gray-100 dark:text-neutral-300 dark:hover:bg-neutral-900")
                    }
                  >
                    {p.title}
                  </Link>
                  {active && !q && p.toc.length > 0 && (
                    <ul className="mt-1 mb-2 ml-2 space-y-0.5 border-l border-divide pl-3">
                      {p.toc.map((t) => (
                        <li key={t.id}>
                          <a href={`#${t.id}`} className="block py-0.5 text-[13px] text-gray-600 hover:text-charcoal-900 dark:text-neutral-400 dark:hover:text-white">
                            {t.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {groups.size === 0 && <p className="text-gray-600">No pages match.</p>}
    </nav>
  );

  return (
    <>
      <aside className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-64 shrink-0 overflow-y-auto pr-6 lg:block">
        {list}
      </aside>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mb-4 rounded-lg border border-divide px-3 py-1.5 text-sm"
          aria-expanded={open}
        >
          {open ? "Hide pages" : "All pages"}
        </button>
        {open && <div className="mb-8 rounded-xl border border-divide p-4">{list}</div>}
      </div>
    </>
  );
};
