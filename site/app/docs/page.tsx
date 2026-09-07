import { redirect } from "next/navigation";
import { DOC_META } from "@/content/docs/registry";

export default function DocsIndex() {
  redirect(`/docs/${DOC_META[0].slug}`);
}
