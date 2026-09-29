import { bedtimeEndDays, formatClock, minutesFromHhmm, nextClockOnDays } from "./display";

/*
 * Recurring rule windows, and a group's internet state and day timeline built from them.
 * Shared by the server, the web app and (through `tests/fixtures/display-vectors.json`)
 * the iOS port, so like `display.ts` nothing here reads the wall clock: callers pass `now`
 * and the household time zone.
 *
 * A window may cross midnight: 22:00–06:00 on Friday blocks Friday 22:00 to Saturday 06:00.
 * `days` are the days a window starts on, 0 = Sunday.
 */

/** `always`: an internet rule with no windows, blocking all day, every day, with no end. */
export type RuleWindowSpec = { name: string; days: number[]; start: string; end: string; always?: boolean };

/** A window of one of the group's internet rules, with the rule it came from. */
export type InternetWindow = RuleWindowSpec & { ruleName: string };

export type Actor = { accountId: string | null; name: string } | null;

export type InternetGroup = {
  suspension: { active: boolean; until: string | null; by?: Actor };
  allowance: { active: boolean; until: string | null; by?: Actor };
};

export type InternetState =
  | { state: "paused"; until: string | null; by: Actor }
  | { state: "blocked"; window: string; until: string | null }
  | { state: "allowed"; window: string | null; until: string | null; by: Actor }
  | { state: "online"; next: { window: string; at: string } | null }
  | { state: "no_rule" };

/** A band on a 24-hour bar, in minutes after local midnight. */
export type DayBand = {
  kind: "window" | "pause" | "allowance";
  from: number;
  to: number;
  /** What the band is: a window's name, "Paused" or "Allowed". */
  label: string;
  /** Where it comes from, for the band's details. */
  source: string;
  /** The part of a window that started the evening before. */
  carried: boolean;
};

const DAY = 1440;

/** The window's name, else its rule's. */
export function windowTitle(window: InternetWindow): string {
  return window.name.trim() || window.ruleName;
}

/** True while `now` falls inside one occurrence of the window. */
export function isWindowActive(window: RuleWindowSpec, now: Date, timeZone: string): boolean {
  if (window.always) return true;
  const start = minutesFromHhmm(window.start);
  const end = minutesFromHhmm(window.end);
  if (start === null || end === null || start === end) return false;
  const weekday = localWeekday(now, timeZone);
  const minutes = localMinutes(now, timeZone);
  if (start < end) return window.days.includes(weekday) && minutes >= start && minutes < end;
  if (window.days.includes(weekday) && minutes >= start) return true;
  return window.days.includes((weekday + 6) % 7) && minutes < end;
}

/** When the occurrence active at `now` ends, or null when the window is not active or never ends. */
export function windowEndsAt(window: RuleWindowSpec, now: Date, timeZone: string): Date | null {
  if (window.always || !isWindowActive(window, now, timeZone)) return null;
  return nextClockOnDays(timeZone, bedtimeEndDays(window.days, window.start, window.end), window.end, now);
}

/** The next time the window starts after `now`. */
export function nextWindowStart(window: RuleWindowSpec, now: Date, timeZone: string): Date | null {
  if (window.always) return null;
  return nextClockOnDays(timeZone, window.days, window.start, now);
}

/**
 * The window's bands on a day that is `weekday`: its own occurrence, and the morning tail
 * of one that started the evening before.
 */
export function windowDayBands(window: RuleWindowSpec, weekday: number): { from: number; to: number; carried: boolean }[] {
  if (window.always) return [{ from: 0, to: DAY, carried: false }];
  const start = minutesFromHhmm(window.start);
  const end = minutesFromHhmm(window.end);
  if (start === null || end === null || start === end) return [];
  const bands: { from: number; to: number; carried: boolean }[] = [];
  if (start > end && window.days.includes((weekday + 6) % 7)) bands.push({ from: 0, to: end, carried: true });
  if (window.days.includes(weekday)) bands.push({ from: start, to: start < end ? end : DAY, carried: false });
  return bands;
}

/**
 * Pairs of windows (by index) that block at the same time on some day. Overlapping
 * windows each keep blocking; access returns when the last one ends.
 */
export function windowOverlaps(windows: RuleWindowSpec[]): [number, number][] {
  const spans = windows.map(weekSpans);
  const pairs: [number, number][] = [];
  for (let a = 0; a < windows.length; a++) {
    for (let b = a + 1; b < windows.length; b++) {
      if (spans[a]!.some(([x0, x1]) => spans[b]!.some(([y0, y1]) => x0 < y1 && y0 < x1))) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** A window's occurrences in minutes of the week from Sunday midnight, wrapped at week end. */
function weekSpans(window: RuleWindowSpec): [number, number][] {
  if (window.always) return [[0, 7 * DAY]];
  const start = minutesFromHhmm(window.start);
  const end = minutesFromHhmm(window.end);
  if (start === null || end === null || start === end) return [];
  const length = start < end ? end - start : DAY - start + end;
  const spans: [number, number][] = [];
  for (const day of new Set(window.days)) {
    const from = day * DAY + start;
    const to = from + length;
    if (to <= 7 * DAY) spans.push([from, to]);
    else spans.push([from, 7 * DAY], [0, to - 7 * DAY]);
  }
  return spans;
}

/**
 * What a group's internet is doing at `now`. A pause blocks everything; an internet
 * window blocks everything unless an allowance lifts it; with no internet rule nothing
 * limits the group. Category, app and website rules are separate and never change this.
 */
export function internetState(group: InternetGroup, windows: InternetWindow[], now: Date, timeZone: string): InternetState {
  if (isActiveUntil(group.suspension, now)) {
    return { state: "paused", until: group.suspension.until, by: group.suspension.by ?? null };
  }
  // The window active longest comes first; one that never ends outlasts them all.
  const lasts = (end: Date | null) => end?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const active = windows
    .filter((window) => isWindowActive(window, now, timeZone))
    .map((window) => ({ window, end: windowEndsAt(window, now, timeZone) }))
    .sort((a, b) => lasts(b.end) - lasts(a.end));
  if (isActiveUntil(group.allowance, now)) {
    return {
      state: "allowed",
      window: active[0] ? windowTitle(active[0].window) : null,
      until: group.allowance.until,
      by: group.allowance.by ?? null,
    };
  }
  if (active[0]) return { state: "blocked", window: windowTitle(active[0].window), until: active[0].end?.toISOString() ?? null };
  if (windows.length === 0) return { state: "no_rule" };
  const next = windows
    .map((window) => ({ window, at: nextWindowStart(window, now, timeZone) }))
    .filter((item): item is { window: InternetWindow; at: Date } => item.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  return { state: "online", next: next ? { window: windowTitle(next.window), at: next.at.toISOString() } : null };
}

/**
 * Every band of no-internet time on today's 24-hour bar: each internet window (with a
 * bedtime that began last night), a pause from now to its end, and an allowance from now
 * to its end drawn over the windows it lifts.
 */
export function internetDayBands(group: InternetGroup, windows: InternetWindow[], now: Date, timeZone: string): DayBand[] {
  const weekday = localWeekday(now, timeZone);
  const minutes = localMinutes(now, timeZone);
  const bands: DayBand[] = windows.flatMap((window) =>
    windowDayBands(window, weekday).map((band) => ({
      kind: "window" as const,
      ...band,
      label: windowTitle(window),
      source: window.name.trim() && window.name.trim() !== window.ruleName ? `${window.ruleName} rule · ${window.name.trim()}` : `${window.ruleName} rule`,
    })),
  );
  const endToday = (until: string | null) => {
    if (!until) return DAY;
    const end = new Date(until);
    if (localWeekday(end, timeZone) !== weekday || end.getTime() - now.getTime() >= DAY * 60_000) return DAY;
    return Math.max(localMinutes(end, timeZone), minutes + 1);
  };
  const untilText = (until: string | null) => (until ? `until ${formatClock(new Date(until), timeZone)}` : "until resumed");
  if (isActiveUntil(group.suspension, now)) {
    bands.push({
      kind: "pause",
      from: minutes,
      to: endToday(group.suspension.until),
      label: "Paused",
      source: `Paused by ${actorName(group.suspension.by)} ${untilText(group.suspension.until)}`,
      carried: false,
    });
  } else if (isActiveUntil(group.allowance, now)) {
    bands.push({
      kind: "allowance",
      from: minutes,
      to: endToday(group.allowance.until),
      label: "Allowed",
      source: `Allowed by ${actorName(group.allowance.by)} ${untilText(group.allowance.until)}`,
      carried: false,
    });
  }
  return bands;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** The household's day of the week at `now`, 0 = Sunday. */
export function localWeekday(now: Date, timeZone: string): number {
  return localParts(now, timeZone).weekday;
}

function localMinutes(now: Date, timeZone: string): number {
  return localParts(now, timeZone).minutes;
}

function actorName(actor: Actor | undefined): string {
  return actor?.name || "someone";
}

function isActiveUntil(state: { active: boolean; until: string | null }, now: Date): boolean {
  return state.active && (state.until === null || now.getTime() < new Date(state.until).getTime());
}
