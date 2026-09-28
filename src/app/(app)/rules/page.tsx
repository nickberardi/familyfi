import { RulesList } from "@/components/rules/RulesList";

export default function Page({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  return <RulesList searchParams={searchParams} />;
}
