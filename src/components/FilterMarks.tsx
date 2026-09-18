"use client";

/**
 * Category and app filter marks on a comfortable card.
 *
 * Card System: every comfortable card can carry two more rows below the band —
 * a fixed category catalog and open-ended app rules. Each mark is its own
 * policy with its own popover; the card-level Pause/Schedule pair stays with
 * Internet alone.
 *
 * A mark shows whichever thing is actually blocking the category. An enabled
 * FamilyFi rule wins and renders in the accent; otherwise the mark falls back to
 * what this group's own resolver reports, in purple. The colour answers *who*,
 * which is why upstream does not borrow the accent.
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
import {
  categoryMarkLabel,
  categoryMarkState,
  categoryMarkWord,
  effectiveCheck,
  ruleActivelyBlocking,
  upstreamCategoryForSlot,
  type CategoryMarkState,
  type UpstreamCategoryRow,
} from "@/lib/upstream";
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
  state,
  onClick,
  children,
}: {
  label: string;
  state: CategoryMarkState;
  onClick: () => void;
  children: ReactNode;
}) {
  const fill =
    state === "on"
      ? "var(--ff-accent)"
      : state === "blocked"
        ? "var(--ff-upstream-fill)"
        : state === "partial"
          ? "var(--ff-upstream-tint)"
          : "var(--ff-field)";
  const ink =
    state === "on" || state === "blocked"
      ? "var(--ff-ink-on-fill)"
      : state === "partial"
        ? "var(--ff-upstream-ink)"
        : "var(--ff-ink-2)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={categoryMarkLabel(label, state)}
      className="flex w-[52px] flex-col items-center gap-1"
    >
      <span
        className="flex h-[34px] w-[34px] items-center justify-center rounded-full"
        style={{ background: fill, color: ink }}
      >
        {children}
      </span>
      <span className="text-[10px]" style={{ color: "var(--ff-ink-2)" }}>
        {label}
      </span>
      <span
        className="text-[9px]"
        style={{ color: state === "off" ? "var(--ff-ink-4)" : "var(--ff-ink-3)" }}
      >
        {categoryMarkWord(state)}
      </span>
    </button>
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
              // A rule blocking *right now* wins; otherwise this group's resolver
              // decides. A scheduled rule outside its window is not blocking.
              const upstream = upstreamCategoryForSlot(upstreamCategories ?? [], slot.slot);
              const check = upstream ? effectiveCheck(upstream.checks, group) : null;
              const blocking = ruleActivelyBlocking(rule, timezone);
              const state = categoryMarkState(blocking, check);
              return (
                <MarkButton
                  key={slot.slot}
                  label={slot.label}
                  state={state}
                  onClick={() =>
                    setSheet({
                      kind: "category",
                      name: slot.label,
                      categoryId: slot.categoryId,
                      rule,
                      upstream: check,
                      activelyBlocking: blocking,
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
                    state={ruleActivelyBlocking(rule, timezone) ? "on" : "off"}
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
