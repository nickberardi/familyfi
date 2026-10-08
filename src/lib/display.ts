import { WEEKDAYS, addCalendarDays, bedtimeEndDays, formatClock, minutesFromHhmm, nextClockOnDays, zonedParts } from "./clock";
import type { IconName } from "./icons";
import { internetState, type InternetWindow } from "./rule-windows";
import type { Group } from "./types";

// The clock helpers live in ./clock; every client still finds them here.
export { bedtimeEndDays, formatClock, minutesFromHhmm, nextClockOnDays };

/*
 * Display copy and state shared by every surface. familyfi-mobile imports this module, its
 * Apple Watch (native Swift) ports it, and `tests/fixtures/display-vectors.json` holds the cases
 * all must pass. So nothing
 * here reads the wall clock or the server's time zone: a function that needs the time
 * takes `now` and the household `timezone` from its caller.
 */

export function accessLabel(access: string): string {
  if (access === "paused") return "Paused · all internet off";
  if (access === "blocked") return "No internet · scheduled";
  if (access === "allowed") return "Online · allowed during a schedule";
  return "Internet available";
}

export function accessColor(access: string): string {
  if (access === "paused") return "var(--ff-paused)";
  if (access === "blocked") return "var(--ff-accent)";
  return "var(--ff-on)";
}

export function localNowPercent(timezone: string, now: Date): string {
  const parts = zonedParts(now, timezone);
  return `${(((parts.hour * 60 + parts.minute) / 1440) * 100).toFixed(3)}%`;
}

export function roleLabel(role: string | null): string {
  if (role === "child") return "Child";
  if (role === "teen") return "Teen";
  if (role === "adult") return "Adult";
  return "";
}

export function roleTag(group: Pick<Group, "kind" | "familyRole">): string {
  if (group.kind === "things") return "device group";
  if (group.familyRole === "adult") return "adult";
  if (group.familyRole === "teen") return "teen";
  if (group.familyRole === "child") return "child";
  return "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "•";
}

/**
 * Device types, as one ordered table.
 *
 * The word and the glyph answer the same question — what is this thing — so they are
 * declared together and matched once. Two lists would drift, and a laptop drawn as a
 * phone reads as a fact about the device rather than a styling slip.
 *
 * Matching is on the hostname UniFi reports, which is whatever the household named it,
 * so this is a best guess and the order matters: "Apple TV" is a television before it
 * is a Mac. A hostname we cannot place is `Device` with the question glyph — the shape
 * of "not yet known", which is exactly what a new arrival is. Never guess a type from
 * nothing; a wrong icon is worse than an honest blank.
 */
const DEVICE_KINDS: readonly { match: RegExp; label: string; icon: IconName }[] = [
  { match: /\bapple ?tv\b|\btv\b|roku|chromecast|firestick|\bvizio\b/, label: "TV", icon: "television" },
  { match: /iphone|pixel|galaxy|\bphone\b/, label: "Phone", icon: "device-mobile" },
  { match: /ipad|tablet|kindle|\bfire hd\b/, label: "Tablet", icon: "device-tablet" },
  { match: /watch/, label: "Watch", icon: "watch" },
  {
    match: /macbook|imac|\bmac\b|laptop|chromebook|thinkpad|surface|desktop|\bpc\b/,
    label: "Computer",
    icon: "laptop",
  },
  {
    match: /echo|homepod|sonos|speaker|airpods|\bhifi\b/,
    label: "Speaker",
    icon: "speaker-high",
  },
  { match: /printer|epson|officejet|laserjet|\bbrother\b/, label: "Printer", icon: "printer" },
  {
    match: /playstation|\bps[45]\b|xbox|nintendo/,
    label: "Console",
    icon: "game-controller",
  },
  {
    match: /router|gateway|firewalla|access point|\bap\b|unifi|\budm\b/,
    label: "Network",
    icon: "network",
  },
];

function deviceKind(hostname: string | null): { label: string; icon: IconName } {
  const name = (hostname ?? "").toLowerCase();
  return (
    DEVICE_KINDS.find((kind) => kind.match.test(name)) ?? {
      label: "Device",
      icon: "question" as const,
    }
  );
}

export function deviceKindLabel(hostname: string | null): string {
  return deviceKind(hostname).label;
}

export function deviceIcon(hostname: string | null): IconName {
  return deviceKind(hostname).icon;
}

export function formatHhmm(value: string): string {
  const minutes = minutesFromHhmm(value);
  if (minutes === null) return value;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 || 12;
  return minute === 0 ? `${twelve} ${period}` : `${twelve}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "Every day", "Mon–Fri", "Weekends", or the days listed, for the days a window starts on. */
export function daysLabel(days: number[]): string {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  const key = unique.join();
  if (key === "0,1,2,3,4,5,6") return "Every day";
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "0,1,2,3,4") return "Sun–Thu";
  if (key === "0,6") return "Weekends";
  if (key === "5,6") return "Fri–Sat";
  return unique.map((day) => WEEKDAYS[day] ?? "").filter(Boolean).join(", ");
}

/** "9:30 PM–6:45 AM". */
export function windowTimes(start: string, end: string): string {
  return `${formatHhmm(start)}–${formatHhmm(end)}`;
}

/** The line under a card's name: its devices, and how many internet windows it has. */
export function cardNoteLine(group: Group, windows: InternetWindow[]): string {
  if (group.deviceCount === 0 && (group.internetRuleIds.length > 0 || group.suspension.active)) {
    return "No devices · rules cannot apply on UniFi until you assign one";
  }
  const devices = `${group.deviceCount} ${group.deviceCount === 1 ? "device" : "devices"}`;
  if (windows.length === 0) return `${devices} · no internet rule`;
  if (windows.some((window) => window.always)) return `${devices} · internet off always`;
  return `${devices} · ${windows.length} internet ${windows.length === 1 ? "window" : "windows"}`;
}

/**
 * What the group's internet is doing now, naming the scope and its source: a pause
 * (and who paused), the window blocking it, an allowance, or the next window.
 */
export function cardStateLabel(group: Group, windows: InternetWindow[], timezone: string, now: Date): string {
  const state = internetState(group, windows, now, timezone);
  const by = (actor: { name: string } | null) => (actor ? ` by ${actor.name}` : "");
  const until = (at: string | null, open: string) => (at ? `until ${formatClock(new Date(at), timezone)}` : open);
  switch (state.state) {
    case "paused":
      return `All internet paused ${until(state.until, "until resumed")}${by(state.by)}`;
    case "blocked":
      return `No internet · ${state.window} ${until(state.until, "· always")}`;
    case "allowed":
      return `Online · allowed ${until(state.until, "until you resume the schedule")}${by(state.by)}`;
    case "online":
      return state.next ? `Online · ${state.next.window} at ${formatClock(new Date(state.next.at), timezone)}` : "Online";
    case "no_rule":
      if (group.kind === "family" && group.familyRole === "adult") return "No controls applied";
      return "Online · no internet rule";
    default:
      return "Online";
  }
}

/**
 * "today" / "tomorrow" / a weekday name, for a scheduled instant relative to `now` —
 * both compared as calendar dates in the household timezone, since a UTC-day boundary
 * can fall in the middle of a local day.
 */
export function relativeDayLabel(instant: Date, timezone: string, now: Date): string {
  const today = zonedParts(now, timezone);
  const target = zonedParts(instant, timezone);
  if (today.year === target.year && today.month === target.month && today.day === target.day) return "today";
  const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
  if (tomorrow.year === target.year && tomorrow.month === target.month && tomorrow.day === target.day) {
    return "tomorrow";
  }
  return WEEKDAYS[target.weekday] ?? "";
}

