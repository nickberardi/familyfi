"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { FamRule } from "@/lib/fam-rules";
import type { Group } from "@/lib/types";
import { useAppData } from "./AppDataProvider";
import { GroupFilterMarks } from "./FilterMarks";
import { GroupCard } from "./GroupCard";
import { groupActions } from "./group-actions";
import { PauseSheet } from "./PauseSheet";

type DpiItem = { id: number; name: string };

export function GroupGrid({ kind }: { kind: "family" | "things" }) {
  const { groups, household, mutate } = useAppData();
  const [sheet, setSheet] = useState<{ group: Group; mode: "pause" | "extend" } | null>(null);
  const [rules, setRules] = useState<FamRule[]>([]);
  const [catalogNames, setCatalogNames] = useState<Map<string, string>>(new Map());
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
      const [{ rules: next }, cats, apps] = await Promise.all([
        api<{ rules: FamRule[] }>("/api/v1/rules"),
        api<{ categories: DpiItem[] }>("/api/v1/dpi/categories").catch(() => ({ categories: [] as DpiItem[] })),
        api<{ applications: DpiItem[] }>("/api/v1/dpi/applications").catch(() => ({ applications: [] as DpiItem[] })),
      ]);
      setRules(next);
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
      <header className="sticky top-0 z-20 flex items-center gap-3.5 border-b border-[var(--ff-line)] bg-[rgba(245,245,247,.86)] px-4 py-4 backdrop-blur md:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[21px] font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{sub}</p>
        </div>
        <Link
          href={kind === "family" ? "/family/new" : "/things/new"}
          className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-white"
        >
          Add
        </Link>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] md:p-6">
        {rows.length === 0 ? (
          <p className="rounded-[12px] bg-white p-[18px] text-[14px] text-[var(--ff-muted)] md:border md:border-[var(--ff-hairline-card)]">
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
