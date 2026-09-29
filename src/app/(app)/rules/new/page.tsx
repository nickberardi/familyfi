import { RuleEditorPage } from "@/components/rules/RuleEditor";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[]; kind?: string | string[]; target?: string | string[] }>;
}) {
  return <RuleEditorPage searchParams={searchParams} />;
}
