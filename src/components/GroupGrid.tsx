"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";
import { GroupFilterMarks } from "./FilterMarks";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import { GroupCard } from "./GroupCard";
import { groupActions } from "./group-actions";
import { PageHeader } from "./PageHeader";
import { PauseSheet } from "./PauseSheet";

type DpiItem = { id: number; name: string };

export function GroupGrid({ kind }: { kind: "family" | "things" }) {
  const { groups, household, mutate } = useAppData();
  const [sheet, setSheet] = useState<{ group: Group; mode: "pause" | "extend" } | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [catalogNames, setCatalogNames] = useState<Map<string, string>>(new Map());
  const [upstreamCategories, setUpstreamCategories] = useState<UpstreamCategoryRow[]>([]);
  const rows = groups.filter((group) => group.kind === kind);
  const timezone = household?.timezone ?? "America/New_York";
  const title = kind === "family" ? "Family" : "Things";
  const paused = rows.filter((group) => group.access === "paused").map((group) => group.name);
  const sub =
    kind === "family"
      ? paused.length
        ? `${paused.join(" and ")} paused · everyone else follows their bedtime`
        : "Everyone online right now"
      : "Device groups that are not a person. House destinations are Things groups.";

  const loadRules = useCallback(async () => {
    try {
      const [{ rules: next }, cats, apps, upstream] = await Promise.all([
        api<{ rules: Rule[] }>("/api/v1/rules"),
        api<{ categories: DpiItem[] }>("/api/v1/dpi/categories").catch(() => ({ categories: [] as DpiItem[] })),
        api<{ applications: DpiItem[] }>("/api/v1/dpi/applications").catch(() => ({ applications: [] as DpiItem[] })),
        // Each card resolves its own verdict from these — two kids on different
        // resolvers show different answers on the same page.
        api<{ categories: UpstreamCategoryRow[] }>("/api/v1/upstream/categories").catch(() => ({
          categories: [] as UpstreamCategoryRow[],
        })),
      ]);
      setRules(next);
      setUpstreamCategories(upstream.categories);
      const map = new Map<string, string>();
      for (const item of cats.categories) map.set(`category:${item.id}`, item.name);
      for (const item of apps.applications) map.set(`app:${item.id}`, item.name);
      setCatalogNames(map);
    } catch {
      setRules([]);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadRules();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [loadRules]);

  return (
    <>
      <PageHeader
        title={title}
        sub={sub}
        actionHref={kind === "family" ? "/family/new" : "/things/new"}
        actionLabel="Add"
      />
      <div className="grid grid-cols-1 items-start gap-4 p-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] md:p-6">
        {rows.length === 0 ? (
          <p className="rounded-[12px] bg-[var(--ff-card)] p-[18px] text-[14px] text-[var(--ff-muted)] md:border md:border-[var(--ff-hairline-card)]">
            Nothing here yet.
          </p>
        ) : (
          rows.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              href={kind === "family" ? `/family/${group.id}` : `/things/${group.id}`}
              timezone={timezone}
              phoneActions={groupActions(group, "phone", (item) => setSheet({ group: item, mode: "pause" }), (item) => setSheet({ group: item, mode: "extend" }), mutate)}
              webActions={groupActions(group, "web", (item) => setSheet({ group: item, mode: "pause" }), (item) => setSheet({ group: item, mode: "extend" }), mutate)}
              filterMarks={
                group.protected ? undefined : (
                  <GroupFilterMarks
                    group={group}
                    rules={rules}
                    catalogNames={catalogNames}
                    upstreamCategories={upstreamCategories}
                    timezone={household?.timezone ?? "UTC"}
                    onRulesChanged={() => void loadRules()}
                  />
                )
              }
            />
          ))
        )}
      </div>
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
