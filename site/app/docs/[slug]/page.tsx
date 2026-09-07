import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { DOC_META, getDoc } from "@/content/docs/registry";

export function generateStaticParams() {
  return DOC_META.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return {};
  return { title: `${doc.title} — Tollbooth docs`, description: doc.summary };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const i = DOC_META.findIndex((p) => p.slug === slug);
  const prev = DOC_META[i - 1];
  const next = DOC_META[i + 1];
  const Body = doc.Component;
  return (
    <article className="max-w-3xl">
      <div className="font-mono text-[11px] tracking-wide text-gray-600 uppercase dark:text-neutral-400">
        {doc.section}
      </div>
      <h1 className="mt-1 text-3xl font-medium tracking-tight text-charcoal-900 md:text-4xl dark:text-white">
        {doc.title}
      </h1>
      <p className="mt-3 text-[15px] leading-7 text-gray-600 dark:text-neutral-400">{doc.summary}</p>
      <div className="mt-8">
        <Body />
      </div>
      <nav className="mt-16 flex justify-between border-t border-divide pt-6 text-sm" aria-label="Pagination">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="text-brand underline-offset-4 hover:underline">
            ← {prev.title}
          </Link>
        ) : <span />}
        {next ? (
          <Link href={`/docs/${next.slug}`} className="text-brand underline-offset-4 hover:underline">
            {next.title} →
          </Link>
        ) : <span />}
      </nav>
    </article>
  );
}
