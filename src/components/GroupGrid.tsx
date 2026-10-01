"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { loadFilterCatalog, type CatalogNames } from "@/lib/category-marks";
import { groupPageSummary, groupPageTitle } from "@/lib/group-page";
import { householdTimezone } from "@/lib/household-state";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import { EmptyCard } from "@/ui/EmptyCard";
import { GroupCard } from "./GroupCard";
import { PageHeader } from "./PageHeader";
import { NewGroupSheet } from "./NewGroupSheet";
import { PauseSheet } from "./PauseSheet";

/** DPI catalog names and upstream verdicts: what a card's marks need beyond the household. */
export function useFilterCatalog() {
  const [catalog, setCatalog] = useState<{ catalogNames: CatalogNames; upstreamCategories: UpstreamCategoryRow[] }>({
    catalogNames: new Map(),
    upstreamCategories: [],
  });
  useEffect(() => {
    const handle = window.setTimeout(() => void loadFilterCatalog(request).then(setCatalog), 0);
    return () => window.clearTimeout(handle);
  }, []);
  return catalog;
}

export function GroupGrid({ kind }: { kind: "family" | "things" }) {
  const { groups, rules, household, reload } = useAppData();
  const [sheet, setSheet] = useState<{ group: Group; mode: "pause" | "extend" } | null>(null);
  const [adding, setAdding] = useState(false);
  const { catalogNames, upstreamCategories } = useFilterCatalog();
  const rows = groups.filter((group) => group.kind === kind);
  const timezone = householdTimezone(household);
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
