"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { groupPageSummary, groupPageTitle } from "@/lib/group-page";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import { EmptyCard } from "@/ui/EmptyCard";
import { GroupCard } from "./GroupCard";
import { PageHeader } from "./PageHeader";
import { NewGroupSheet } from "./NewGroupSheet";
import { PauseSheet } from "./PauseSheet";

type DpiItem = { id: number; name: string };

/** DPI catalog names and upstream verdicts: what a card's marks need beyond the household. */
export function useFilterCatalog() {
  const [catalogNames, setCatalogNames] = useState<Map<string, string>>(new Map());
  const [upstreamCategories, setUpstreamCategories] = useState<UpstreamCategoryRow[]>([]);
  const load = useCallback(async () => {
    const [cats, apps, upstream] = await Promise.all([
      api<{ categories: DpiItem[] }>("/api/v1/dpi/categories").catch(() => ({ categories: [] as DpiItem[] })),
      api<{ applications: DpiItem[] }>("/api/v1/dpi/applications").catch(() => ({ applications: [] as DpiItem[] })),
      // Each card resolves its own verdict from these — two kids on different
      // resolvers show different answers on the same page.
      api<{ categories: UpstreamCategoryRow[] }>("/api/v1/upstream/categories").catch(() => ({
        categories: [] as UpstreamCategoryRow[],
      })),
    ]);
    const map = new Map<string, string>();
    for (const item of cats.categories) map.set(`category:${item.id}`, item.name);
    for (const item of apps.applications) map.set(`app:${item.id}`, item.name);
    setCatalogNames(map);
    setUpstreamCategories(upstream.categories);
  }, []);
  useEffect(() => {
    const handle = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(handle);
  }, [load]);
  return { catalogNames, upstreamCategories };
}

export function GroupGrid({ kind }: { kind: "family" | "things" }) {
  const { groups, rules, household, reload } = useAppData();
  const [sheet, setSheet] = useState<{ group: Group; mode: "pause" | "extend" } | null>(null);
  const [adding, setAdding] = useState(false);
  const { catalogNames, upstreamCategories } = useFilterCatalog();
  const rows = groups.filter((group) => group.kind === kind);
  const timezone = household?.timezone ?? "America/New_York";
  const title = groupPageTitle(kind);
  const sub = groupPageSummary(kind, groups);

  return (
    <>
      <PageHeader
        title={title}
        sub={sub}
        actionLabel="Add"
        onAction={() => setAdding(true)}
      />
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] md:p-6">
        {rows.length === 0 ? (
          <EmptyCard />
        ) : (
          rows.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              href={kind === "family" ? `/family/${group.id}` : `/things/${group.id}`}
              timezone={timezone}
              rules={rules}
              catalogNames={catalogNames}
              upstreamCategories={upstreamCategories}
              onPause={() => setSheet({ group, mode: "pause" })}
              onExtend={() => setSheet({ group, mode: "extend" })}
              onRulesChanged={() => void reload()}
            />
          ))
        )}
      </div>
      {adding ? <NewGroupSheet kind={kind} onClose={() => setAdding(false)} /> : null}
      {sheet ? (
        <PauseSheet
          group={sheet.group}
          mode={sheet.mode}
          timezone={timezone}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
