"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api";
import { readCatalogNames, loadUpstreamCategories, type CatalogNames } from "@/lib/category-marks";
import { groupPageSummary, groupPageTitle } from "@/lib/group-page";
import { householdTimezone } from "@/lib/household-state";
import type { GroupSheetTarget } from "@/lib/group-pause-sheet";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import { EmptyCard } from "@/ui/EmptyCard";
import { GroupCard } from "./GroupCard";
import { PageHeader } from "./PageHeader";
import { NewGroupSheet } from "./NewGroupSheet";
import { PauseSheet } from "./PauseSheet";

/**
 * DPI catalog names, read once and shared by every page that shows marks: the full app list is
 * large and changes only with the console. A read that failed or brought nothing is tried again next time.
 */
let sharedNames: Promise<CatalogNames> | null = null;
let lastNames: CatalogNames = new Map();

function catalogNames(): Promise<CatalogNames> {
  sharedNames ??= readCatalogNames(request).then(({ names, complete }) => {
    if (!complete || names.size === 0) sharedNames = null;
    else lastNames = names;
    return names;
  });
  return sharedNames;
}

/** Drops the shared names, so the next page reads them again (tests, and a change of console). */
export function forgetCatalogNames() {
  sharedNames = null;
  lastNames = new Map();
}

/**
 * DPI catalog names and, unless `upstream` is false, upstream verdicts: what a card's marks need
 * beyond the household. The verdicts are read on every visit, since probes and edits change them.
 */
export function useFilterCatalog({ upstream = true }: { upstream?: boolean } = {}) {
  const [catalog, setCatalog] = useState<{ catalogNames: CatalogNames; upstreamCategories: UpstreamCategoryRow[] }>(() => ({
    catalogNames: lastNames,
    upstreamCategories: [],
  }));
  useEffect(() => {
    let current = true;
    const handle = window.setTimeout(() => {
      void catalogNames().then((names) => current && setCatalog((now) => (now.catalogNames === names ? now : { ...now, catalogNames: names })));
      if (upstream) void loadUpstreamCategories(request).then((rows) => current && setCatalog((now) => ({ ...now, upstreamCategories: rows })));
    }, 0);
    return () => {
      current = false;
      window.clearTimeout(handle);
    };
  }, [upstream]);
  return catalog;
}

export function GroupGrid({ kind }: { kind: "family" | "things" }) {
  const { groups, rules, household } = useAppData();
  const [sheet, setSheet] = useState<{ group: Group; target: GroupSheetTarget } | null>(null);
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
              onSheet={(target) => setSheet({ group, target })}
            />
          ))
        )}
      </div>
      {adding ? <NewGroupSheet kind={kind} onClose={() => setAdding(false)} /> : null}
      {sheet ? (
        <PauseSheet
          // The group as it is now, since a write may have changed it after the sheet opened.
          group={groups.find((group) => group.id === sheet.group.id) ?? sheet.group}
          target={sheet.target}
          timezone={timezone}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
