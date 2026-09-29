"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/display";
import { internetDayBands, internetState, type InternetWindow } from "@/lib/rule-windows";
import { internetRulePresets, type InternetRulePreset } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { useAppData } from "./AppDataProvider";
import { DayTimeline, type TimelineBand } from "./DayTimeline";
import { groupActions } from "./group-actions";

/**
 * The group's device-wide controls, kept apart from its category marks: whether all of
 * its internet is on, the day's no-internet time, and Pause / Resume / Allow, each named
 * for its scope. A group with no internet rule says so, rather than implying one exists.
 */
export function InternetZone({
  group,
  windows,
  timezone,
  surface,
  onPause,
  onExtend,
  editHref,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  surface: "phone" | "web";
  onPause: () => void;
  onExtend: () => void;
  /** Where "Edit internet rule" goes; omitted where the page already links to rules. */
  editHref?: string;
}) {
  const { mutate } = useAppData();
  const now = new Date();
  const state = internetState(group, windows, now, timezone);
  const devices = group.deviceCount === 1 ? "its 1 device" : `all ${group.deviceCount} of its devices`;
  const at = (iso: string | null) => (iso ? formatClock(new Date(iso), timezone) : null);
  const by = (actor: { name: string } | null) => (actor ? ` by ${actor.name}` : "");

  if (state.state === "protected") {
    return (
      <Zone tone="neutral" title="All internet · never limited" sub={`Protected — FamilyFi never blocks ${group.name}.`} />
    );
  }

  const actions = groupActions(group, surface, onPause, onExtend, mutate).filter((action) => action.onClick);
  const bands: TimelineBand[] = internetDayBands(group, windows, now, timezone);
  const timeline = (
    <>
      <DayTimeline bands={bands} timezone={timezone} label={`${group.name}’s internet today`} />
      {editHref ? (
        <Link href={editHref} className="self-end text-[14px] font-semibold text-[var(--ff-accent)]">
          Edit internet rule
        </Link>
      ) : null}
    </>
  );

  if (state.state === "no_rule") {
    return (
      <div className="flex flex-col gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-[var(--ff-control-line)] p-3">
        <ZoneHeading
          icon={<Icon name="globe-simple" size={16} />}
          iconStyle={{ border: "1.5px dashed var(--ff-control-line)", color: "var(--ff-ink-3)" }}
          title="All internet · no rule"
          sub={`Nothing limits ${group.name}’s internet. Category rules still apply on their own.`}
          actions={actions}
        />
        <Presets group={group} />
      </div>
    );
  }

  const off = state.state === "paused" || state.state === "blocked";
  const sub =
    state.state === "paused"
      ? `Paused${state.until ? ` until ${at(state.until)}` : " until you resume"}${by(state.by)}, on ${devices}.`
      : state.state === "blocked"
        ? `${state.window} until ${at(state.until)}, on ${devices}.`
        : state.state === "allowed"
          ? `${state.window ?? "The schedule"} lifted${state.until ? ` until ${at(state.until)}` : ""}${by(state.by)}, on ${devices}.`
          : state.next
            ? `${state.next.window} starts at ${at(state.next.at)}, on ${devices}.`
            : `Online on ${devices}.`;

  return (
    <Zone
      tone={state.state === "paused" ? "paused" : off ? "off" : "on"}
      title={off ? "All internet · off" : "All internet · on"}
      sub={sub}
      actions={actions}
    >
      {timeline}
    </Zone>
  );
}

type Action = { label: string; onClick?: () => void; strong?: boolean };

function Zone({
  tone,
  title,
  sub,
  actions = [],
  children,
}: {
  tone: "on" | "off" | "paused" | "neutral";
  title: string;
  sub: string;
  actions?: Action[];
  children?: ReactNode;
}) {
  const background = tone === "paused" ? "var(--ff-paused-fill)" : tone === "off" ? "var(--ff-accent-wash)" : "var(--ff-field-soft)";
  const iconStyle =
    tone === "paused"
      ? { background: "var(--ff-paused)", color: "var(--ff-ink-on-fill)" }
      : tone === "off"
        ? { background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }
        : { background: "var(--ff-field)", color: "var(--ff-ink-2)" };
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] p-3" style={{ background }}>
      <ZoneHeading icon={<Icon name="globe-simple" size={16} />} iconStyle={iconStyle} title={title} sub={sub} actions={actions} />
      {children}
    </div>
  );
}

function ZoneHeading({
  icon,
  iconStyle,
  title,
  sub,
  actions,
}: {
  icon: ReactNode;
  iconStyle: CSSProperties;
  title: string;
  sub: string;
  actions: Action[];
}) {
  return (
    <div className="flex flex-wrap items-start gap-2.5">
      <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px]" style={iconStyle}>
        {icon}
      </span>
      <div className="min-w-[140px] flex-1">
        <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
        <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-ink-2)]">{sub}</p>
      </div>
      {actions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="rounded-[8px] px-2.5 py-1.5 text-[14px] font-semibold"
              style={
                action.strong
                  ? { background: "var(--ff-accent)", color: "var(--ff-ink-on-fill)" }
                  : { background: "var(--ff-card)", color: "var(--ff-accent)", boxShadow: "inset 0 0 0 1px var(--ff-control-line)" }
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One tap to a common internet rule; anything else goes to the rule editor. */
function Presets({ group }: { group: Group }) {
  const { mutate } = useAppData();
  const presets = internetRulePresets(group);
  const add = (preset: InternetRulePreset) =>
    void mutate(
      () =>
        api("/api/v1/rules", {
          method: "POST",
          body: JSON.stringify({
            name: preset.name,
            kind: "internet",
            groupIds: [group.id],
            mode: "scheduled",
            windows: [{ name: preset.name, days: preset.days, start: preset.start, end: preset.end }],
          }),
        }),
      undefined,
      { notice: `${preset.name} added for ${group.name}. FamilyFi writes it to the gateway next.` },
    );
  const chip =
    "inline-flex items-center gap-1 rounded-full border border-[var(--ff-accent-line)] bg-[var(--ff-card)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ff-accent)]";
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <button key={preset.name} type="button" className={chip} onClick={() => add(preset)}>
          <Icon name="plus" size={12} />
          {preset.label}
        </button>
      ))}
      <Link className={chip} href={`/rules/new?kind=internet&group=${group.id}`}>
        <Icon name="plus" size={12} />
        Custom schedule
      </Link>
    </div>
  );
}
