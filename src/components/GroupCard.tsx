"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { accessColor, cardNoteLine, cardStateLabel, localNowPercent, roleTag, scheduleBands } from "@/lib/display";
import type { Group } from "@/lib/types";

export type CardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  strong?: boolean;
};

export function ScheduleBar({
  start,
  end,
  timezone,
}: {
  start: string | null;
  end: string | null;
  timezone: string;
}) {
  const bands = scheduleBands(start, end);
  return (
    <div>
      <div className="relative h-[30px] overflow-hidden rounded-[6px] bg-[var(--ff-well)] md:h-[26px]">
        {bands.map((band, index) => (
          <div
            key={index}
            className="absolute top-0 bottom-0 bg-[var(--ff-accent)] opacity-85"
            style={{ left: band.left, width: band.width }}
          />
        ))}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-[var(--ff-now)]"
          style={{ left: localNowPercent(timezone, new Date()) }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[14px] text-[var(--ff-muted)]">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>NOON</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </div>
  );
}

export function GroupCard({
  group,
  href,
  timezone,
  phoneActions,
  webActions,
  filterMarks,
}: {
  group: Group;
  href: string;
  timezone: string;
  phoneActions: CardAction[];
  webActions: CardAction[];
  filterMarks?: ReactNode;
}) {
  const things = group.kind === "things";
  const monogram = (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
  const state = cardStateLabel(group, timezone);
  const stateColor = accessColor(group.access);
  const note = cardNoteLine(group);
  const enabled = group.schedule.enabled && group.schedule.start && group.schedule.end;

  return (
    <article className="overflow-hidden rounded-[12px] bg-[var(--ff-card)] md:border md:border-[var(--ff-hairline-card)]">
      <Link href={href} className="flex items-center gap-3 px-4 py-3.5 md:items-start md:px-[18px] md:py-4">
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
            <span className="hidden text-[14px] text-[var(--ff-muted)] md:inline">{roleTag(group)}</span>
            <span className="ml-auto text-[14px] md:hidden" style={{ color: stateColor }}>
              {state}
            </span>
          </div>
          <div className="mt-1 hidden items-center gap-1.5 text-[14px] md:flex" style={{ color: stateColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateColor }} />
            {state}
          </div>
          <div className="mt-0.5 hidden text-[14px] text-[var(--ff-muted)] md:block">{note}</div>
        </div>
        <span className="flex-none text-[17px] text-[var(--ff-disabled)] md:hidden" aria-hidden>
          ›
        </span>
      </Link>
      <div className="px-4 pb-3.5 md:px-[18px]">
        <ScheduleBar
          start={enabled ? group.schedule.start : null}
          end={enabled ? group.schedule.end : null}
          timezone={timezone}
        />
        <p className="mt-2 text-[14px] leading-5 text-[var(--ff-muted)] md:hidden">{note}</p>
      </div>
      {filterMarks}
      <ActionRow actions={phoneActions} className="md:hidden" />
      <ActionRow actions={webActions} className="hidden md:flex" />
    </article>
  );
}

function ActionRow({ actions, className }: { actions: CardAction[]; className?: string }) {
  if (actions.length === 0) return null;
  return (
    <div className={`flex border-t border-[var(--ff-hairline-strong)] ${className ?? ""}`}>
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
