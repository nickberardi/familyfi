"use client";

import { useState } from "react";
import Link from "next/link";
import { windowTimes } from "@/lib/display";
import { internetDayBands, localWeekday } from "@/lib/rule-windows";
import { appRulesForGroup, glyphForAppName, internetWindowsForGroup, parentFacingRuleLabel, ruleDayBands, type Rule } from "@/lib/rules";
import { appMarkState, categoryMarkStyle, ruleActivelyBlocking, type UpstreamCategoryRow } from "@/lib/upstream";
import type { Group } from "@/lib/types";
import { Icon } from "./ui/Icon";
import { DayTimeline, type TimelineBand } from "./DayTimeline";
import { categorySheet, categorySlotStates, CategoryMarkGlyph, MarkButton, SectionLabel, type CategorySlotState } from "./FilterMarks";
import { FilterSheet, type FilterSheetState } from "./filters/FilterSheet";
import { InternetZone } from "./InternetZone";
import { GroupCardFrame } from "@/ui/GroupCardFrame";
import { InternetMark } from "@/ui/InternetMark";

export type CardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  strong?: boolean;
};

/** Category marks on a closed card, before "More". */
const CLOSED_MARKS = 4;
/** Other-category marks on an open card, before "More". */
const OPEN_MARKS = 5;

/**
 * A person or group of things, as the Family and Things pages show it.
 *
 * Closed, the card is its state and one row of marks: the Internet mark (all internet on
 * every device), a divider, then its categories with FamilyFi's own rules first. Opening
 * it — the header, or any mark — shows the internet zone with today's no-internet time
 * and its controls, one focused category in the rule's lighter treatment, and the other
 * categories. Device-wide and category controls never share a zone.
 */
export function GroupCard({
  group,
  href,
  timezone,
  rules,
  catalogNames,
  upstreamCategories,
  onPause,
  onExtend,
  onRulesChanged,
}: {
  group: Group;
  href: string;
  timezone: string;
  rules: Rule[];
  catalogNames: Map<string, string>;
  upstreamCategories: UpstreamCategoryRow[];
  onPause: () => void;
  onExtend: () => void;
  onRulesChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);

  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);

  // FamilyFi's own rules first, then the resolver's verdicts.
  const slots = categorySlotStates(group, rules, upstreamCategories, timezone);
  const ordered = [...slots.filter((item) => item.rule?.enabled), ...slots.filter((item) => !item.rule?.enabled)];
  const focused = ordered.find((item) => item.key === focus) ?? ordered[0];
  const pool = open ? ordered.filter((item) => item !== focused) : ordered;
  const cap = open ? OPEN_MARKS : CLOSED_MARKS;
  const shown = more ? pool : pool.slice(0, cap);
  const apps = appRulesForGroup(rules, group.id);

  const openOn = (slot?: string) => {
    if (slot) setFocus(slot);
    setOpen(true);
  };

  return (
    <GroupCardFrame group={group} windows={windows} timezone={timezone} now={now} open={open} onToggle={() => setOpen(!open)}>

      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <InternetZone
            group={group}
            windows={windows}
            timezone={timezone}
            surface="web"
            onPause={onPause}
            onExtend={onExtend}
            editHref={`/rules?group=${group.id}`}
          />
          {focused ? (
            <CategoryZone
              group={group}
              item={focused}
              rules={rules}
              timezone={timezone}
              onOpenSheet={() => setSheet(categorySheet(focused))}
            />
          ) : null}
        </div>
      ) : null}

      <div data-testid={`filter-marks-${group.id}`}>
        {open ? (
          <div className="px-[18px] pt-1 text-[11px] font-semibold tracking-[0.05em] text-[var(--ff-ink-2)] uppercase">
            Other categories
          </div>
        ) : null}
        <div className="flex flex-wrap items-start gap-3 px-[18px] pt-1 pb-3.5">
          {open ? null : (
            <>
              <InternetMark group={group} windows={windows} timezone={timezone} now={now} onPress={() => openOn()} />
              <span aria-hidden className="mt-0.5 mb-3.5 w-px self-stretch bg-[var(--ff-hairline-strong)]" />
            </>
          )}
          {shown.map((item) => (
            <span key={item.key} className="relative">
              <MarkButton label={item.label} state={item.state} onClick={() => openOn(item.key)}>
                <CategoryMarkGlyph item={item} size={15} />
              </MarkButton>
            </span>
          ))}
          {pool.length > cap ? (
            <button
              type="button"
              onClick={() => setMore(!more)}
              aria-label={more ? "Show fewer categories" : `Show all ${ordered.length} categories`}
              className="flex w-[52px] flex-col items-center gap-1"
            >
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-dashed border-[var(--ff-control-line)] text-[10px] font-bold text-[var(--ff-accent)]">
                {more ? "–" : `+${pool.length - cap}`}
              </span>
              <span className="text-[10px] text-[var(--ff-accent)]">{more ? "Fewer" : "More"}</span>
              <span className="text-[9px]">{" "}</span>
            </button>
          ) : null}
        </div>
        {open && apps.length ? (
          <div className="border-t border-[var(--ff-hairline)] px-[18px] pt-2 pb-3.5">
            <SectionLabel>App rules</SectionLabel>
            <div className="flex flex-wrap gap-3 pt-2">
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
            </div>
          </div>
        ) : null}
      </div>

      {open ? (
        <ActionRow
          actions={[
            { label: "Rules", href: `/rules?group=${group.id}` },
            { label: "Details", href },
          ]}
        />
      ) : null}

      {sheet ? (
        <FilterSheet group={group} state={sheet} onClose={() => setSheet(null)} onChanged={onRulesChanged} />
      ) : null}
    </GroupCardFrame>
  );
}

/**
 * The focused category: a FamilyFi rule's windows over the group's faded internet time,
 * or, with no rule, what the resolver reports and a way to add one.
 */
function CategoryZone({
  group,
  item,
  rules,
  timezone,
  onOpenSheet,
}: {
  group: Group;
  item: CategorySlotState;
  rules: Rule[];
  timezone: string;
  onOpenSheet: () => void;
}) {
  const rule = item.rule?.enabled ? item.rule : undefined;
  const style = categoryMarkStyle(item.state);
  if (!rule) {
    const words = { blocked: "blocked upstream", partial: "partly blocked upstream", open: "open upstream", unknown: "not checked", rule: "" };
    return (
      <div className="flex items-center gap-2.5 rounded-[10px] bg-[var(--ff-field-soft)] px-3 py-2.5">
        <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-full" style={{ background: style.fill, color: style.ink }}>
          <CategoryMarkGlyph item={item} size={14} />
        </span>
        <span className="min-w-0 flex-1 text-[14px]">
          <span className="font-semibold">{item.label}</span>
          <span className="text-[var(--ff-ink-2)]"> · no rule · {words[item.state]}</span>
        </span>
        <button type="button" onClick={onOpenSheet} className="flex flex-none items-center gap-1 text-[14px] font-semibold text-[var(--ff-accent)]">
          <Icon name="plus" size={14} />
          Add rule
        </button>
      </div>
    );
  }
  const now = new Date();
  const weekday = localWeekday(now, timezone);
  const internet = internetWindowsForGroup(rules, group.id, now);
  const faded = internetDayBands({ suspension: { active: false, until: null }, allowance: { active: false, until: null } }, internet, now, timezone);
  const bands: TimelineBand[] = [
    ...faded.map((band) => ({ ...band, kind: "faded" as const })),
    ...ruleDayBands(rule, weekday).map((band) => ({
      kind: "category" as const,
      from: band.from,
      to: band.to,
      label: `${item.label} blocked`,
      source: `${rule.name} rule${band.window.name.trim() && rule.mode === "scheduled" ? ` · ${band.window.name.trim()}` : ""}`,
    })),
  ];
  const when = rule.mode === "always" ? "Always blocked by FamilyFi." : `Blocked ${rule.windows.map((window) => windowTimes(window.start, window.end)).join(" and ")}.`;
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] p-3" style={{ background: item.blocking ? "var(--ff-verdict-rule-fill)" : "var(--ff-field-soft)" }}>
      <div className="flex flex-wrap items-start gap-2.5">
        <span
          aria-hidden
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
          style={
            item.blocking
              ? { background: "var(--ff-verdict-rule-ink)", color: "var(--ff-ink-on-fill)" }
              : { background: "var(--ff-verdict-rule-fill)", color: "var(--ff-verdict-rule-ink)" }
          }
        >
          <CategoryMarkGlyph item={item} size={14} />
        </span>
        <div className="min-w-[140px] flex-1">
          <h3 className="m-0 text-[14px] font-semibold">
            {item.label} · {item.blocking ? "blocked" : "allowed now"}
          </h3>
          <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-ink-2)]">{when} Everything else stays on.</p>
        </div>
        <Link
          href={`/rules/${rule.id}?group=${group.id}`}
          className="rounded-[8px] bg-[var(--ff-card)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ff-accent)] shadow-[inset_0_0_0_1px_var(--ff-control-line)]"
        >
          Edit rule
        </Link>
      </div>
      <DayTimeline bands={bands} timezone={timezone} label={`${group.name}’s ${item.label} today`} />
      {internet.length ? <p className="text-[14px] text-[var(--ff-ink-2)]">No-internet time also covers {item.label}.</p> : null}
    </div>
  );
}

function ActionRow({ actions }: { actions: CardAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex border-t border-[var(--ff-hairline-strong)]">
      {actions.map((action, index) => {
        const className =
          "flex-1 py-3 text-center text-[16px] md:py-2.5 md:text-[14px] " +
          (action.strong ? "font-semibold text-[var(--ff-accent)]" : "font-medium text-[var(--ff-accent)]");
        const style = { borderLeft: index ? "1px solid var(--ff-hairline-strong)" : undefined };
        if (action.href) {
          return (
            <Link key={action.label} href={action.href} className={className} style={style}>
              {action.label}
            </Link>
          );
        }
        return (
          <button key={action.label} type="button" onClick={action.onClick} className={className} style={style}>
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
