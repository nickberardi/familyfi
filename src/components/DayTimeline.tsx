"use client";

import { useState } from "react";
import { formatHhmm, localNowPercent } from "@/lib/display";

/**
 * Today on a 24-hour bar: the time a group has no internet, and why.
 *
 * Internet windows are the accent, a pause the paused ink, and an allowance an outlined
 * gap over the window it lifts. Category, app and website windows use the rule verdict's
 * lighter treatment, with the internet windows faded behind them, so a category schedule
 * never reads as losing all internet. Every band is a button: choosing one names its
 * source (the rule and window, or who paused).
 */
export type TimelineBand = {
  kind: "window" | "pause" | "allowance" | "category" | "faded";
  from: number;
  to: number;
  label: string;
  source: string;
};

const STYLE: Record<TimelineBand["kind"], { background: string; opacity?: number; boxShadow?: string }> = {
  window: { background: "var(--ff-accent)", opacity: 0.85 },
  pause: { background: "var(--ff-paused)" },
  allowance: { background: "var(--ff-card)", boxShadow: "inset 0 0 0 1px var(--ff-accent-line)" },
  category: { background: "var(--ff-verdict-rule-fill)", boxShadow: "inset 0 0 0 1px var(--ff-verdict-rule-line)" },
  faded: { background: "var(--ff-accent)", opacity: 0.22 },
};

const percent = (minutes: number) => `${((minutes / 1440) * 100).toFixed(3)}%`;

function clock(minutes: number): string {
  const whole = minutes % 1440;
  return formatHhmm(`${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`);
}

export function bandTimes(band: Pick<TimelineBand, "from" | "to">): string {
  return `${clock(band.from)}–${clock(band.to)}`;
}

export function DayTimeline({
  bands,
  timezone,
  label,
  legend = true,
}: {
  bands: TimelineBand[];
  timezone: string;
  /** What the bar shows, for its accessible name: "Emma's internet today". */
  label: string;
  legend?: boolean;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const picked = chosen !== null ? bands[chosen] : undefined;
  // Allowances and pauses are drawn last, over the windows they change.
  const order = bands.map((band, index) => ({ band, index })).sort((a, b) => rank(a.band) - rank(b.band));
  const items = legendItems(bands);

  return (
    <div>
      <div
        role="group"
        aria-label={label}
        className="relative h-[22px] overflow-hidden rounded-[6px] bg-[var(--ff-well)]"
      >
        {order.map(({ band, index }) => (
          <button
            key={index}
            type="button"
            aria-label={`${band.label}, ${bandTimes(band)}. ${band.source}`}
            aria-pressed={chosen === index}
            onClick={() => setChosen(chosen === index ? null : index)}
            className="absolute top-0 bottom-0 cursor-pointer border-0 p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            style={{ left: percent(band.from), width: percent(Math.max(band.to - band.from, 4)), ...STYLE[band.kind] }}
          />
        ))}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[var(--ff-now)]"
          style={{ left: localNowPercent(timezone, new Date()) }}
        />
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[14px] text-[var(--ff-muted)]">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>NOON</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
      <p aria-live="polite" className="text-[14px] text-[var(--ff-ink-2)]">
        {picked ? (
          <>
            <span className="font-semibold text-[var(--ff-ink)]">{picked.label}</span> · {bandTimes(picked)} · {picked.source}
          </>
        ) : null}
      </p>
      {legend && items.length ? (
        <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-[var(--ff-ink-2)]">
          {items.map((item) => (
            <li key={`${item.kind}:${item.label}:${item.source}`} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={STYLE[item.kind]} />
              {item.label} {item.times}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function rank(band: TimelineBand): number {
  return { faded: 0, category: 1, window: 2, allowance: 3, pause: 4 }[band.kind];
}

/** One legend entry per window, joining its evening and morning pieces. */
function legendItems(bands: TimelineBand[]) {
  const items: { kind: TimelineBand["kind"]; label: string; source: string; times: string }[] = [];
  for (const band of bands) {
    if (band.kind === "faded") continue;
    // One entry per window: two rules may name a window alike, so the source tells them apart.
    if (items.some((item) => item.kind === band.kind && item.label === band.label && item.source === band.source)) continue;
    const same = bands.filter((other) => other.kind === band.kind && other.label === band.label && other.source === band.source);
    // Last night's tail and tonight's start of one window read as one span.
    const tail = same.find((other) => other.from === 0 && other.to < 1440);
    const evening = same.find((other) => other.to === 1440 && other.from > 0);
    const times = tail && evening ? `${clock(evening.from)}–${clock(tail.to)}` : same.map(bandTimes).join(", ");
    items.push({ kind: band.kind, label: band.label, source: band.source, times });
  }
  return items;
}
