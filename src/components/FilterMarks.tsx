"use client";

/**
 * Category and app filter marks on a comfortable card.
 *
 * Card System: every comfortable card can carry two more rows below its internet
 * zone — a fixed category catalog and open-ended app rules. Each mark is its own
 * rule with its own popover; Pause, Resume and Allow stay with all internet alone,
 * in the zone above, so a category control never reads as a device-wide one.
 *
 * A mark shows whichever thing is actually blocking the category. A FamilyFi rule
 * blocking right now wins and renders in red, the same red as the sheet's Turn off;
 * otherwise the mark falls back to what this group's own resolver reports, in purple.
 * The colour answers *who*, which is why neither borrows the accent. Green is a
 * measured all-clear and grey is "we have not looked" — never the same thing.
 */

import { useState, type ReactNode } from "react";
import {
  CURATED_CATEGORY_SLOTS,
  appRulesForGroup,
  categoryRuleForSlot,
  glyphForAppName,
  parentFacingRuleLabel,
  type CuratedCategorySlot,
  type Rule,
} from "@/lib/rules";
import type { IconName } from "@/lib/icons";
import { upstreamCategoryIcon } from "@/lib/upstream-domains";
import { Icon } from "@/components/ui/Icon";
import {
  appMarkState,
  categoryMarkLabel,
  categoryMarkState,
  categoryMarkStyle,
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

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ff-ink-2)" }}>
      {children}
    </div>
  );
}

/** A 34px mark with its label and state word beneath, per the Card System. */
export function MarkButton({
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
  const { fill, ink } = categoryMarkStyle(state);
  const word = categoryMarkWord(state);
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
      {/*
        Always rendered, even when wordless, so marks in a row keep one baseline.
        --ff-ink-2, not the ink-3 this used to take: 9px text may not sit below 0.7
        alpha (AGENTS.md), and ink-3 was 3.4:1 on the card.
      */}
      <span className="text-[9px]" style={{ color: "var(--ff-ink-2)" }}>
        {word || "\u00A0"}
      </span>
    </button>
  );
}

/**
 * A household category as a group sees it: its rule, its resolver's verdict and its
 * mark state. `slot` is the UniFi DPI category FamilyFi can block it with; a category
 * without one (AI, Dating, one the household made) can only be reported, or blocked
 * by its websites.
 */
export type CategorySlotState = {
  key: string;
  label: string;
  slot: CuratedCategorySlot | undefined;
  /** The seeded category's glyph, when it has no DPI slot to draw. */
  icon: IconName | undefined;
  monogram: string;
  /** The domains the resolver checks for it, for a Websites rule. */
  domains: string[];
  rule: Rule | undefined;
  check: ReturnType<typeof effectiveCheck>;
  blocking: boolean;
  state: CategoryMarkState;
};

/** Every household category: the ones UniFi can block first, then the rest as listed. */
export function categorySlotStates(
  group: Group,
  rules: Rule[],
  upstreamCategories: UpstreamCategoryRow[],
  timezone: string,
): CategorySlotState[] {
  const seededSlot = (row: UpstreamCategoryRow) =>
    row.source === "seed" ? CURATED_CATEGORY_SLOTS.find((slot) => slot.slot === row.slug) : undefined;
  const mapped = CURATED_CATEGORY_SLOTS.map((slot) => {
    const upstream = upstreamCategoryForSlot(upstreamCategories, slot.slot);
    return { slot, upstream: upstream && seededSlot(upstream) ? upstream : undefined };
  });
  const others = upstreamCategories.filter((row) => !seededSlot(row)).map((row) => ({ slot: undefined, upstream: row }));
  return [...mapped, ...others].map(({ slot, upstream }) => {
    const rule = slot ? categoryRuleForSlot(rules, group.id, slot.categoryId) : undefined;
    // A rule blocking *right now* wins; otherwise this group's resolver decides.
    const check = upstream ? effectiveCheck(upstream.checks, group) : null;
    const blocking = ruleActivelyBlocking(rule, timezone);
    return {
      key: slot?.slot ?? upstream!.slug,
      label: slot?.label ?? upstream!.label,
      slot,
      icon: upstream ? upstreamCategoryIcon(upstream.slug, upstream.source) : undefined,
      monogram: upstream?.monogram ?? slot!.label.slice(0, 3).toUpperCase(),
      domains: upstream ? upstream.domains.filter((domain) => !domain.removed).map((domain) => domain.domain) : [],
      rule,
      check,
      blocking,
      state: categoryMarkState(blocking, check),
    };
  });
}

/** The sheet a category's mark opens. */
export function categorySheet(item: CategorySlotState): FilterSheetState {
  return {
    kind: "category",
    name: item.label,
    categoryId: item.slot ? item.slot.categoryId : null,
    domains: item.domains,
    rule: item.rule,
    upstream: item.check,
    activelyBlocking: item.blocking,
  };
}

/** A category's glyph: its DPI slot's mark, its seeded icon, or its monogram. */
export function CategoryMarkGlyph({ item, size }: { item: CategorySlotState; size: number }) {
  if (item.slot) return <CategoryGlyph slot={item.slot.slot} size={size} />;
  if (item.icon) return <Icon name={item.icon} size={size} />;
  return <span className="text-[9px] font-bold">{item.monogram}</span>;
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
              <MarkButton key={item.key} label={item.label} state={item.state} onClick={() => setSheet(categorySheet(item))}>
                <CategoryMarkGlyph item={item} size={15} />
              </MarkButton>
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
                  <MarkButton
                    key={rule.id}
                    label={name}
                    state={appMarkState(ruleActivelyBlocking(rule, timezone))}
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
