"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { accessColor, cardNoteLine, cardStateLabel, roleTag } from "@/lib/display";
import { filterRulesForGroup, internetWindowsForGroup, ruleBlocksLabel, ruleDayBands, type Rule } from "@/lib/rules";
import { internetDayBands, localWeekday } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";
import { DayTimeline, type TimelineBand } from "./DayTimeline";
import { InternetZone } from "./InternetZone";

export type CardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  strong?: boolean;
};

export function GroupCard({
  group,
  href,
  timezone,
  rules,
  catalogNames,
  onPause,
  onExtend,
  filterMarks,
}: {
  group: Group;
  href: string;
  timezone: string;
  rules: Rule[];
  catalogNames: Map<string, string>;
  onPause: () => void;
  onExtend: () => void;
  filterMarks?: ReactNode;
}) {
  const things = group.kind === "things";
  const monogram = (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
  const windows = internetWindowsForGroup(rules, group.id);
  const state = cardStateLabel(group, windows, timezone, new Date());
  const stateColor = accessColor(group.access);
  const note = cardNoteLine(group, windows);
  const footer: CardAction[] = group.protected
    ? [{ label: "Detail", href }]
    : [
        { label: "Rules", href: `/rules?group=${group.id}` },
        { label: "Detail", href },
      ];

  return (
    <article className="overflow-hidden rounded-[12px] bg-[var(--ff-card)] md:border md:border-[var(--ff-hairline-card)]">
      <Link href={href} className="flex items-center gap-3 px-4 pt-3.5 pb-3 md:items-start md:px-[18px] md:pt-4">
        {things ? (
          <div
            className="flex h-11 w-11 flex-none items-center justify-center rounded-[11px] bg-[var(--ff-mark)] text-[14px] font-bold tracking-wide text-[var(--ff-ink-on-fill)]"
            style={{ fontSize: monogram.length > 2 ? 12 : 14 }}
          >
            {monogram}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[19px] font-semibold tracking-tight md:text-[17px]">{group.name}</span>
            <span className="text-[14px] text-[var(--ff-muted)]">{roleTag(group)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[14px]" style={{ color: stateColor }}>
            <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: stateColor }} />
            {state}
          </div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">{note}</div>
        </div>
        <span className="flex-none text-[17px] text-[var(--ff-disabled)] md:hidden" aria-hidden>
          ›
        </span>
      </Link>
      <div className="px-3 pb-3">
        <InternetZone
          group={group}
          windows={windows}
          timezone={timezone}
          surface="web"
          onPause={onPause}
          onExtend={onExtend}
        />
      </div>
      {group.protected ? null : (
        <>
          {filterMarks}
          <FilterSchedule group={group} rules={rules} catalogNames={catalogNames} timezone={timezone} />
        </>
      )}
      <ActionRow actions={footer} />
    </article>
  );
}

/**
 * Today's category, app and website windows for the group, drawn in the rule verdict's
 * lighter treatment over faded internet windows, so a Video schedule on the TV reads as
 * Video only, never as losing all internet (US-7).
 */
export function FilterSchedule({
  group,
  rules,
  catalogNames,
  timezone,
}: {
  group: Group;
  rules: Rule[];
  catalogNames: Map<string, string>;
  timezone: string;
}) {
  const now = new Date();
  const weekday = localWeekday(now, timezone);
  const scheduled = filterRulesForGroup(rules, group.id).filter((rule) => rule.enabled && rule.mode === "scheduled");
  if (scheduled.length === 0) return null;
  const internet = internetDayBands({ ...group, protected: false, suspension: { active: false, until: null }, allowance: { active: false, until: null } }, internetWindowsForGroup(rules, group.id), now, timezone);
  const bands: TimelineBand[] = [
    ...internet.map((band) => ({ ...band, kind: "faded" as const })),
    ...scheduled.flatMap((rule) =>
      ruleDayBands(rule, weekday).map((band) => ({
        kind: "category" as const,
        from: band.from,
        to: band.to,
        label: band.window.name.trim() && rule.mode === "scheduled" ? `${rule.name} · ${band.window.name.trim()}` : rule.name,
        source: ruleBlocksLabel(rule, catalogNames),
      })),
    ),
  ];
  return (
    <div className="border-t border-[var(--ff-hairline)] px-[18px] pt-2 pb-3">
      <div className="mb-2 text-[11px] font-semibold tracking-[0.05em] text-[var(--ff-ink-2)] uppercase">
        Category schedules today
      </div>
      <DayTimeline bands={bands} timezone={timezone} label={`${group.name}’s category schedules today`} />
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
