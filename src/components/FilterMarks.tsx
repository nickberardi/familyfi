"use client";

/**
 * A group's category and app marks with the sheets they open, on the web's group detail. The marks
 * and their logic are shared with the native app (`src/ui/CategoryMarks.tsx`,
 * `src/lib/category-marks.ts`); the sheets are the web's own.
 */

import { useState, type ReactNode } from "react";
import { appRulesForGroup, glyphForAppName, parentFacingRuleLabel, type Rule } from "@/lib/rules";
import { categorySheet, categorySlotStates } from "@/lib/category-marks";
import { appMarkState, ruleActivelyBlocking, type UpstreamCategoryRow } from "@/lib/upstream";
import { AddAppMark, AppMark, CategoryMark } from "@/ui/CategoryMarks";
import { FilterSheet, type FilterSheetState } from "@/components/filters/FilterSheet";
import { AddAppSheet } from "@/components/filters/AddAppSheet";
import type { Group } from "@/lib/types";

/** The web's small section heading, in the page's line height. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ff-ink-2)" }}>
      {children}
    </div>
  );
}

export function GroupFilterMarks({
  group,
  rules,
  catalogNames,
  upstreamCategories,
  timezone,
  showAppAdd,
  onRulesChanged,
}: {
  group: Group;
  rules: Rule[];
  catalogNames: Map<string, string>;
  /**
   * Upstream categories with every measured verdict. The mark resolves its own with
   * `effectiveCheck(…, group)`, so a kid on their own resolver reports that resolver.
   */
  upstreamCategories?: UpstreamCategoryRow[];
  /** Household IANA zone — a scheduled rule is only blocking inside its local window. */
  timezone: string;
  /** The + tile is a member-page action only, never the family-list card (A5). */
  showAppAdd?: boolean;
  onRulesChanged: () => void;
}) {
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);
  const [addApp, setAddApp] = useState(false);

  const apps = appRulesForGroup(rules, group.id);
  /** Without app rules and without the + tile the section is a heading over nothing. */
  const showApps = apps.length > 0 || Boolean(showAppAdd);

  return (
    <>
      <div
        className="pb-2.5"
        style={{ borderTop: "1px solid var(--ff-hairline)" }}
        data-testid={`filter-marks-${group.id}`}
      >
        <div className="px-[18px] pt-2">
          <SectionLabel>Category rules</SectionLabel>
          <div className="flex flex-wrap gap-3.5 py-2">
            {categorySlotStates(group, rules, upstreamCategories ?? [], timezone).map((item) => (
              <CategoryMark key={item.key} item={item} onPress={() => setSheet(categorySheet(item))} />
            ))}
          </div>
        </div>

        {showApps ? (
          <div className="px-[18px] pt-2" style={{ borderTop: "1px solid var(--ff-hairline)" }}>
            <SectionLabel>App Rules</SectionLabel>
            <div className="flex flex-wrap gap-3.5 py-2 pb-1">
              {apps.map((rule) => {
                const name = parentFacingRuleLabel(rule, catalogNames);
                return (
                  <AppMark
                    key={rule.id}
                    label={name}
                    glyph={glyphForAppName(name)}
                    state={appMarkState(ruleActivelyBlocking(rule, timezone))}
                    onPress={() => setSheet({ kind: "app", name, rule })}
                  />
                );
              })}
              {showAppAdd ? <AddAppMark onPress={() => setAddApp(true)} /> : null}
            </div>
          </div>
        ) : null}
      </div>

      {sheet ? (
        <FilterSheet
          group={group}
          state={sheet}
          onClose={() => setSheet(null)}
          onChanged={onRulesChanged}
        />
      ) : null}
      {addApp ? (
        <AddAppSheet group={group} onClose={() => setAddApp(false)} onCreated={onRulesChanged} />
      ) : null}
    </>
  );
}
