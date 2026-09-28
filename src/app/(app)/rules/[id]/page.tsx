import { RuleEditorPage } from "@/components/rules/RuleEditor";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ group?: string | string[] }>;
}) {
  return <RuleEditorPage params={params} searchParams={searchParams} />;
}
