"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { Card } from "@/components/ui/Controls";
import { RuleRow, type ScheduleDraft } from "@/components/rules/RuleRow";
import { NewRuleSheet } from "@/components/rules/NewRuleSheet";
import { buildRuleRows, type RuleRow as RuleRowModel } from "@/lib/rule-rows";
import { D6_CATEGORY_SLOTS, type Rule } from "@/lib/rules";

type DpiItem = { id: number; name: string };

export default function RulesPage() {
  const { groups, unifi, mutate } = useAppData();
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  const loadGen = useRef(0);

  const loadRules = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const [{ rules: next }, cats, apps] = await Promise.all([
        api<{ rules: Rule[] }>("/api/v1/rules"),
        api<{ categories: DpiItem[] }>("/api/v1/dpi/categories").catch(() => ({
          categories: [] as DpiItem[],
        })),
        api<{ applications: DpiItem[] }>("/api/v1/dpi/applications").catch(() => ({
          applications: [] as DpiItem[],
        })),
      ]);
      if (gen !== loadGen.current) return;
      const map = new Map<string, string>();
      for (const item of cats.categories) map.set(`category:${item.id}`, item.name);
      for (const item of apps.applications) map.set(`app:${item.id}`, item.name);
      for (const slot of D6_CATEGORY_SLOTS) map.set(`category:${slot.categoryId}`, slot.label);
      setRules(next);
      setLabels(map);
    } catch {
      if (gen !== loadGen.current) return;
      setRules([]);
    }
  }, []);

  // Deferred past the effect body so the initial fetch does not set state
  // synchronously during the commit, matching AppDataProvider's loader.
  useEffect(() => {
    const start = window.setTimeout(() => void loadRules(), 0);
    return () => {
      window.clearTimeout(start);
      loadGen.current += 1;
    };
  }, [loadRules]);

  const rows = buildRuleRows({
    groups,
    rules,
    labels,
    networkNames: new Map((unifi?.networks ?? []).map((n) => [n.id, n.name])),
  });

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [rows.length]);

  /** Internet rows persist through the group schedule route; filters through /rules. */
  async function persistMode(row: RuleRowModel, mode: "always" | "scheduled", draft: ScheduleDraft) {
    if (row.group) {
      await mutate(() =>
        api(`/api/v1/groups/${row.group!.id}/schedule`, {
          method: "PUT",
          body: JSON.stringify({
            enabled: mode === "scheduled",
            days: draft.days,
            start: draft.start,
            end: draft.end,
          }),
        }),
      );
      return;
    }
    await mutate(() =>
      api(`/api/v1/rules/${row.rule!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          mode,
          ...(mode === "scheduled"
            ? { schedule: { enabled: true, days: draft.days, start: draft.start, end: draft.end } }
            : {}),
        }),
      }),
    );
    await loadRules();
  }

  async function persistSchedule(row: RuleRowModel, draft: ScheduleDraft) {
    if (draft.start === draft.end || draft.days.length === 0) return;
    await persistMode(row, "scheduled", draft);
  }

  async function toggleEnabled(row: RuleRowModel) {
    if (row.group) {
      const path = row.enabled ? "pause" : "resume";
      await mutate(() =>
        api(`/api/v1/groups/${row.group!.id}/${path}`, { method: "POST", body: "{}" }),
      );
      return;
    }
    if (row.enabled) {
      await mutate(() =>
        api(`/api/v1/rules/${row.rule!.id}/off`, { method: "POST", body: "{}" }),
      );
    } else {
      await mutate(() =>
        api(`/api/v1/rules/${row.rule!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: true }),
        }),
      );
    }
    await loadRules();
  }

  async function remove(row: RuleRowModel) {
    if (!row.rule) return;
    await mutate(() => api(`/api/v1/rules/${row.rule!.id}`, { method: "DELETE" }));
    await loadRules();
  }

  const visibleGroups = groups.filter((group) => !group.protected);

  return (
    <>
      <PageHeader
        title="Rules"
        sub="Recurring bedtimes and content-filter schedules — desired configuration, applied on the next Sync."
        actionLabel="Add"
        onAction={() => setNewRuleOpen(true)}
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {rows.length === 0 ? (
          <Card>
            <p className="p-[18px] text-[14px]" style={{ color: "var(--ff-ink-3)" }}>
              Add a Family or Things group first. Protected groups have no FamilyFi Internet rules.
            </p>
          </Card>
        ) : (
          <Card>
            {rows.map((row) => (
              <RuleRow
                key={row.id}
                row={row}
                onModeChange={(mode, draft) => void persistMode(row, mode, draft)}
                onScheduleChange={(draft) => void persistSchedule(row, draft)}
                onToggleEnabled={() => void toggleEnabled(row)}
                onDelete={() => void remove(row)}
              />
            ))}
          </Card>
        )}

        <p className="max-w-[70ch] text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
          Each member row is the Internet parent for that Family or Things group; nested rows are its
          category and app filters. NET rows are network-scoped rules on Settings-managed VLANs.
          Always keeps the block on until you turn it off; Scheduled uses Offline / Back on times.
          Edits here are desired configuration — they are written to UniFi on the next reconcile, and
          Sync shows whether the gateway accepted them. Internet rows are not deletable.
        </p>
      </div>

      {newRuleOpen ? (
        <NewRuleSheet
          groups={visibleGroups}
          onClose={() => setNewRuleOpen(false)}
          onCreated={() => void loadRules()}
        />
      ) : null}
    </>
  );
}
