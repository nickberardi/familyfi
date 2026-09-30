import { formatHhmm } from "./display";

/**
 * Today on a 24-hour bar: the time a group has no internet, and why. Every client draws the bar
 * from these: its bands, their order, their colours (as `--ff-*` token names), the hour labels,
 * and the legend. Internet windows are the accent, a pause the paused ink, and an allowance an
 * outlined gap over the window it lifts. Category, app and website windows use the rule
 * verdict's lighter treatment, with the internet windows faded behind them, so a category
 * schedule never reads as losing all internet.
 */
export type TimelineBand = {
  kind: "window" | "pause" | "allowance" | "category" | "faded";
  from: number;
  to: number;
  label: string;
  source: string;
};

/** How a band is filled: a token name for its fill, its opacity, and an optional inset outline. */
export type TimelineBandLook = { fill: string; opacity?: number; line?: string };

export const TIMELINE_BAND_LOOK: Record<TimelineBand["kind"], TimelineBandLook> = {
  window: { fill: "accent", opacity: 0.85 },
  pause: { fill: "paused" },
  allowance: { fill: "card", line: "accent-line" },
  category: { fill: "verdict-rule-fill", line: "verdict-rule-line" },
  faded: { fill: "accent", opacity: 0.22 },
};

/** The hour labels under the bar, left to right. */
export const TIMELINE_HOURS = ["12 AM", "6 AM", "NOON", "6 PM", "12 AM"] as const;

/** A band's share of the day, as a CSS/React Native percentage. */
export function timelinePercent(minutes: number): `${string}%` {
  return `${((minutes / 1440) * 100).toFixed(3)}%`;
}

function clock(minutes: number): string {
  const whole = minutes % 1440;
  return formatHhmm(`${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`);
}

/** "9:30 PM–6:45 AM" for a band. */
export function bandTimes(band: Pick<TimelineBand, "from" | "to">): string {
  return `${clock(band.from)}–${clock(band.to)}`;
}

/** Drawing order: allowances and pauses last, over the windows they change. */
export function timelineRank(band: Pick<TimelineBand, "kind">): number {
  return { faded: 0, category: 1, window: 2, allowance: 3, pause: 4 }[band.kind];
}

/** One legend entry per window, joining its evening and morning pieces. */
export function timelineLegend(bands: TimelineBand[]): { kind: TimelineBand["kind"]; label: string; source: string; times: string }[] {
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
