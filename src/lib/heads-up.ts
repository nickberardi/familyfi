import { zonedFormat } from "@/lib/clock";
import { NO_END_TIME, type GroupDay } from "@/lib/child-day";
import { formatHhmm } from "@/lib/display";
import { nextWindowStart, windowEndsAt } from "@/lib/rule-windows";

/**
 * The heads-up FamilyFi Me gives on a person's own phone shortly before a block starts or ends
 * (familyfi#457): a notice, a countdown on the Lock Screen and in the Dynamic Island (an Android Live
 * Update), and a widget that says what changes next. Everything here is worked out on the phone from
 * the day FamilyFi already answered (`GroupDay`), so nothing about the person is sent anywhere, and the
 * block still starts on time: asking for more time stays the way to get longer.
 *
 * A block is the group's pause, an internet rule that is always on, or one of its scheduled internet
 * windows, each less any time a parent lifted it, as FamilyFi Me's app blocking plans them. Blocks
 * that touch or overlap are one block, named for the first.
 */

/** How long before a block starts or ends the heads-up comes. */
export const HEADS_UP_LEAD_MINUTES = 5;

/** How far ahead the phone plans. It plans again each time it reads FamilyFi. */
export const HEADS_UP_DAYS = 7;

/** One block on the phone's plan. */
export type HeadsUpBlock = {
  /** "Bedtime", the window's name; "Paused" for the group's pause; an always-on rule's name. */
  name: string;
  /** Whether it is the group's pause, which a parent set, not a schedule. */
  pause: boolean;
  /** The one that ends it, when blocks ran into each other: a pause that runs into Bedtime ends as Bedtime. */
  endName: string;
  endPause: boolean;
  /** When the name changes to `endName`, if it does: when the pause that ran into Bedtime ends. */
  switchAt: Date | null;
  from: Date;
  /** null: no end time. */
  to: Date | null;
  /** It begins when time a parent gave (a yes to an ask, an unblock) runs out, not on its schedule. */
  afterExtraTime: boolean;
};

/** The blocks from `now` to `days` ahead, in order, none touching. One under way now starts at `now`. */
export function headsUpBlocks(day: GroupDay, now: Date, days: number = HEADS_UP_DAYS): HeadsUpBlock[] {
  const start = now.getTime();
  const horizon = start + days * 86_400_000;
  type Span = { name: string; pause: boolean; from: number; to: number; afterExtraTime: boolean; endName: string; endPause: boolean; switchAt: number | null };
  const spans: Span[] = [];
  const add = (name: string, pause: boolean, from: number, to: number, liftedUntil?: string | null) => {
    const lift = liftedUntil ? new Date(liftedUntil).getTime() : -Infinity;
    const begin = Math.max(from, start, lift);
    if (begin < to && begin < horizon) spans.push({ name, pause, from: begin, to, afterExtraTime: lift > from && lift > start && begin === lift, endName: name, endPause: pause, switchAt: null });
  };

  if (day.pause) add(PAUSE_NAME, true, start, day.pause.until ? new Date(day.pause.until).getTime() : Infinity);
  for (const rule of day.alwaysOn) if (rule.kind === "internet") add(rule.name, false, start, Infinity, rule.allowed?.until);
  for (const window of day.windows) {
    const name = window.name || window.ruleName;
    const spec = { name: window.name, days: window.days, start: window.start, end: window.end };
    const current = windowEndsAt(spec, now, day.timezone);
    if (current) add(name, false, start, current.getTime(), window.allowed?.until);
    let from = nextWindowStart(spec, now, day.timezone);
    while (from && from.getTime() < horizon) {
      const to = windowEndsAt(spec, from, day.timezone);
      if (!to) break;
      add(name, false, from.getTime(), to.getTime(), window.allowed?.until);
      from = nextWindowStart(spec, to, day.timezone);
    }
  }

  spans.sort((a, b) => a.from - b.from || Number(b.pause) - Number(a.pause));
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) {
      if (span.to > last.to) {
        if (span.endName !== last.endName || span.endPause !== last.endPause) last.switchAt = last.to;
        Object.assign(last, { to: span.to, endName: span.endName, endPause: span.endPause });
      }
    } else merged.push({ ...span });
  }
  return merged.map((span) => ({
    name: span.name,
    pause: span.pause,
    from: new Date(span.from),
    to: span.to === Infinity ? null : new Date(span.to),
    afterExtraTime: span.afterExtraTime,
    endName: span.endName,
    endPause: span.endPause,
    switchAt: span.switchAt === null ? null : new Date(span.switchAt),
  }));
}

/** A pause is named as the day names it (docs/design.md): "Paused". */
const PAUSE_NAME = "Paused";

/** What the heads-up says is stopping: "your apps" with Screen Time on, "your internet" otherwise. */
export type HeadsUpVoice = "apps" | "internet";

/** One heads-up notice, shown at `at`, `HEADS_UP_LEAD_MINUTES` before its block starts or ends at `edge`. */
export type HeadsUpNotice = {
  /** Stable for one block's start or end, so the phone replaces a notice rather than adding a second. */
  id: string;
  at: Date;
  edge: Date;
  kind: "start" | "end";
  title: string;
  body: string;
};

/** The notices for `blocks` that are still to come, in order. */
export function headsUpNotices(blocks: HeadsUpBlock[], now: Date, timeZone: string, voice: HeadsUpVoice): HeadsUpNotice[] {
  const lead = HEADS_UP_LEAD_MINUTES * 60_000;
  const notices: HeadsUpNotice[] = [];
  for (const block of blocks) {
    const startAt = block.from.getTime() - lead;
    if (startAt > now.getTime()) {
      notices.push({ id: `start-${block.from.toISOString()}`, at: new Date(startAt), edge: block.from, kind: "start", ...startWords(block, timeZone, voice) });
    }
    if (block.to && block.to.getTime() - lead > now.getTime()) {
      notices.push({ id: `end-${block.to.toISOString()}`, at: new Date(block.to.getTime() - lead), edge: block.to, kind: "end", ...endWords(block, timeZone, voice) });
    }
  }
  return notices.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function startWords(block: HeadsUpBlock, timeZone: string, voice: HeadsUpVoice): { title: string; body: string } {
  const at = timeAt(block.from, timeZone);
  const stops = voice === "apps" ? `Your apps pause at ${at}.` : `Your internet pauses at ${at}.`;
  if (block.afterExtraTime) return { title: `Your extra time ends in ${HEADS_UP_LEAD_MINUTES} minutes`, body: `${block.name} is back on. ${stops}` };
  return { title: `${block.name} starts in ${HEADS_UP_LEAD_MINUTES} minutes`, body: `Save your game and finish your messages. ${stops}` };
}

function endWords(block: HeadsUpBlock, timeZone: string, voice: HeadsUpVoice): { title: string; body: string } {
  const at = timeAt(block.to!, timeZone);
  const back = voice === "apps" ? `Your apps are back at ${at}.` : `Your internet is back at ${at}.`;
  if (block.endPause) return { title: `Your pause ends in ${HEADS_UP_LEAD_MINUTES} minutes`, body: back };
  return { title: `${block.endName} ends in ${HEADS_UP_LEAD_MINUTES} minutes`, body: back };
}

/**
 * What the countdown and the widget show from `from` on: the next change and when it comes. `until`
 * is when the countdown reaches zero (the next start or end); null when nothing changes in the plan
 * (blocked until a parent ends it, or nothing planned). The widget shows one entry at a time, each
 * from its `from`, and counts down to `until` on its own.
 */
export type HeadsUpEntry = {
  from: Date;
  blocked: boolean;
  /** "Bedtime", "Paused", or "Open" when nothing blocks. */
  title: string;
  /** "Starts at 9 PM", "Ends at 7 AM", "No end time", "Nothing planned". */
  line: string;
  /** The countdown's end, the change `line` names. */
  until: Date | null;
  /** The block the countdown is for: the one starting next, or the one under way. */
  name: string | null;
};

/** The widget's timeline from `now`: one entry for now, then one at each start and each end. */
export function headsUpTimeline(blocks: HeadsUpBlock[], now: Date, timeZone: string): HeadsUpEntry[] {
  const entries: HeadsUpEntry[] = [];
  let at = now;
  for (const block of blocks) {
    if (block.from.getTime() > at.getTime()) {
      entries.push({ from: at, blocked: false, title: block.name, line: `Starts at ${timeAt(block.from, timeZone)}`, until: block.from, name: block.name });
    }
    const from = block.from.getTime() > at.getTime() ? block.from : at;
    const line = block.to ? `Ends at ${timeAt(block.to, timeZone)}` : NO_END_TIME;
    // A pause that ran into Bedtime is told as the pause until it is over, then as Bedtime.
    const switchAt = block.switchAt && block.switchAt.getTime() > from.getTime() ? block.switchAt : null;
    if (switchAt) entries.push({ from, blocked: true, title: block.name, line, until: block.to, name: block.name });
    const title = block.switchAt ? block.endName : block.name;
    entries.push({ from: switchAt ?? from, blocked: true, title, line, until: block.to, name: title });
    if (!block.to) return entries;
    at = block.to;
  }
  entries.push({ from: at, blocked: false, title: OPEN_TITLE, line: "Nothing planned", until: null, name: null });
  return entries;
}

const OPEN_TITLE = "Open";

/** "9 PM", "9:30 PM": the household's wall clock at `date`. */
function timeAt(date: Date, timeZone: string): string {
  const parts = zonedFormat({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return formatHhmm(`${get("hour")}:${get("minute")}`);
}
