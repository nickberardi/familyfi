"use client";

/**
 * Category and app filter marks on a comfortable card.
 *
 * Card System: every comfortable card can carry two more rows below the band —
 * a fixed category catalog and open-ended app rules. Each mark is its own
 * policy with its own popover; the card-level Pause/Schedule pair stays with
 * Internet alone.
 *
 * Two marks from the prototype are deliberately absent: the purple upstream/DNS
 * state and the Porn slot. Both are out for v0.3.0 (issue #29), so a mark here
 * is only ever FamilyFi-owned On or Off.
 */

import { useState, type ReactNode } from "react";
import {
  CURATED_CATEGORY_SLOTS,
  appRulesForGroup,
  categoryRuleForSlot,
  glyphForAppName,
  parentFacingRuleLabel,
  type Rule,
} from "@/lib/rules";
import { CategoryGlyph } from "@/components/ui/CategoryGlyph";
import { FilterSheet, type FilterSheetState } from "@/components/filters/FilterSheet";
import { AddAppSheet } from "@/components/filters/AddAppSheet";
import type { Group } from "@/lib/types";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ff-ink-2)" }}>
      {children}
    </div>
  );
}

/** A 34px mark with its label and state word beneath, per the Card System. */
function MarkButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[52px] flex-col items-center gap-1"
      aria-label={`${label} ${on ? "On" : "Off"}`}
    >
      <div
        className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
        style={{
          background: on ? "var(--ff-accent)" : "var(--ff-field)",
          color: on ? "var(--ff-ink-on-fill)" : "var(--ff-ink-3)",
        }}
      >
        {children}
      </div>
      <div
        className="text-center text-[10px] leading-tight"
        style={{ color: "var(--ff-ink-2)" }}
      >
        {label}
      </div>
      <div
        className="text-[9px] font-semibold"
        style={{ color: on ? "var(--ff-accent)" : "var(--ff-ink-2)" }}
      >
        {on ? "On" : "Off"}
      </div>
    </button>
  );
}

export function GroupFilterMarks({
  group,
  rules,
  catalogNames,
  showAppAdd,
  onRulesChanged,
}: {
  group: Group;
  rules: Rule[];
  catalogNames: Map<string, string>;
  /** The + tile is a member-page action only, never the family-list card (A5). */
  showAppAdd?: boolean;
  onRulesChanged: () => void;
}) {
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);
  const [addApp, setAddApp] = useState(false);

  if (group.protected) return null;

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
          <SectionLabel>Category Rules</SectionLabel>
          <div className="flex flex-wrap gap-3.5 py-2">
            {CURATED_CATEGORY_SLOTS.map((slot) => {
              const rule = categoryRuleForSlot(rules, group.id, slot.categoryId);
              return (
                <MarkButton
                  key={slot.slot}
                  label={slot.label}
                  on={Boolean(rule?.enabled)}
                  onClick={() =>
                    setSheet({
                      kind: "category",
                      name: slot.label,
                      categoryId: slot.categoryId,
                      rule,
                    })
                  }
                >
                  <CategoryGlyph slot={slot.slot} size={15} />
                </MarkButton>
              );
            })}
          </div>
        </div>

        {showApps ? (
          <div className="px-[18px] pt-2" style={{ borderTop: "1px solid var(--ff-hairline)" }}>
            <SectionLabel>App Rules</SectionLabel>
            <div className="flex flex-wrap gap-3.5 py-2 pb-1">
              {apps.map((rule) => {
                const name = parentFacingRuleLabel(rule, catalogNames);
                return (
                  <MarkButton
                    key={rule.id}
                    label={name}
                    on={rule.enabled}
                    onClick={() => setSheet({ kind: "app", name, rule })}
                  >
                    <span className="text-[9px] font-bold">{glyphForAppName(name)}</span>
                  </MarkButton>
                );
              })}
              {showAppAdd ? (
                <button
                  type="button"
                  onClick={() => setAddApp(true)}
                  className="flex w-[52px] flex-col items-center gap-1"
                  aria-label="Add app filter"
                >
                  <div
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] border-dashed text-[16px] font-light leading-none"
                    style={{ borderColor: "var(--ff-control-line)", color: "var(--ff-accent)" }}
                  >
                    +
                  </div>
                  <div
                    className="text-center text-[10px] font-semibold leading-tight"
                    style={{ color: "var(--ff-accent)" }}
                  >
                    Add
                  </div>
                </button>
              ) : null}
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
