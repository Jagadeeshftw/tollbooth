import React from "react";
import { Container } from "@/components/container";
import { Sidebar } from "@/components/docs/sidebar";
import { DOC_META } from "@/content/docs/registry";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container className="border-divide border-x px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-col gap-6 lg:flex-row">
        <Sidebar pages={DOC_META} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Container>
  );
}
