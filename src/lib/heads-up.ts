import { minutesText } from "@/lib/alert-copy";
import { zonedFormat } from "@/lib/clock";
import { ASK_FOR_MORE_TIME, NO_END_TIME, type GroupDay } from "@/lib/child-day";
import { formatHhmm } from "@/lib/display";
import { nextWindowStart, windowEndsAt } from "@/lib/rule-windows";
import { ASK_AHEAD_MINUTES } from "@/lib/rules";

/**
 * The heads-up FamilyFi Me gives on a person's own phone shortly before a block starts or ends
 * (familyfi issue 457): a notice, a countdown on the Lock Screen and in the Dynamic Island (an Android Live
 * Update), and a widget that says what changes next. Everything here is worked out on the phone from
 * the day FamilyFi already answered (`GroupDay`), so nothing about the person is sent anywhere, and the
 * block still starts on time: asking for more time stays the way to get longer.
 *
 * A block is the group's pause, an internet rule that is always on, or one of its scheduled internet
 * windows, each less any time a parent lifted it, as FamilyFi Me's app blocking plans them. Blocks
 * that touch or overlap are one block, named for the first.
 */

/**
 * How long before a block starts or ends the heads-up comes unless the household chose otherwise
 * (`askAheadMinutes`, 0 for off): as long as a person can ask ahead of a window.
 */
export const HEADS_UP_LEAD_MINUTES = ASK_AHEAD_MINUTES;

/** How far ahead the phone plans. It plans again each time it reads FamilyFi. */
export const HEADS_UP_DAYS = 7;

/**
 * The words the countdown and the widget draw around familyfi's lines, in one place so iPhone,
 * Android and the Watch say the same (docs/design.md, "The heads-up before a block").
 */
export const HEADS_UP_WORDS = {
  /** The countdown's button, before a block a person can ask about; the day's own ask button says the same. */
  ask: ASK_FOR_MORE_TIME,
  /** The countdown once its block has started, until the phone takes it down. */
  started: "Started",
  /** The widget's label over what is under way, and over what comes next. */
  now: "Now",
  next: "Next",
  /** Android's notification settings: the notices' channel and the countdown's, each with what it is for. */
  noticesChannel: "Before a block",
  noticesChannelAbout: "Before a block starts or ends.",
  countdownChannel: "Block countdown",
  countdownChannelAbout: "Counts down to a block's start.",
  /** The widget once its plan has run out, or before the phone ever planned: it can't say what is next. */
  unknownTitle: "Not up to date",
  unknownLine: "Open FamilyFi Me to update",
} as const;

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
  // A pause's break (a yes to an ask for a length): the pause blocks again when the extra time runs out.
  if (day.pauseBreak) add(PAUSE_NAME, true, start, day.pauseBreak.pauseUntil ? new Date(day.pauseBreak.pauseUntil).getTime() : Infinity, day.pauseBreak.until);
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
        // The name changes once, when the block it is named for ends; a longer chain is then told by what ends it.
        if (last.switchAt === null && (span.endName !== last.name || span.endPause !== last.pause)) last.switchAt = last.to;
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

/** One heads-up notice, shown at `at`, the household's lead before its block starts or ends at `edge`. */
export type HeadsUpNotice = {
  /** Stable for one block's start or end, so the phone replaces a notice rather than adding a second. */
  id: string;
  at: Date;
  edge: Date;
  kind: "start" | "end";
  title: string;
  /**
   * The title by the clock ("Bedtime starts at 9 PM"), for a phone that posts the notice late: Android
   * may deliver an inexact alarm minutes after `at`, when "in 5 minutes" would no longer be true.
   */
  lateTitle: string;
  body: string;
};

/** The notices for `blocks` that are still to come, in order, `minutes` ahead of each; none when it is 0 (off). */
export function headsUpNotices(
  blocks: HeadsUpBlock[],
  now: Date,
  timeZone: string,
  voice: HeadsUpVoice,
  minutes: number = HEADS_UP_LEAD_MINUTES,
): HeadsUpNotice[] {
  if (minutes <= 0) return [];
  const lead = minutes * 60_000;
  const notices: HeadsUpNotice[] = [];
  for (const block of blocks) {
    const startAt = block.from.getTime() - lead;
    if (startAt > now.getTime()) {
      notices.push({ id: `start-${block.from.toISOString()}`, at: new Date(startAt), edge: block.from, kind: "start", ...startWords(block, timeZone, voice, minutes) });
    }
    if (block.to && block.to.getTime() - lead > now.getTime()) {
      notices.push({ id: `end-${block.to.toISOString()}`, at: new Date(block.to.getTime() - lead), edge: block.to, kind: "end", ...endWords(block, timeZone, voice, minutes) });
    }
  }
  return notices.sort((a, b) => a.at.getTime() - b.at.getTime());
}

type NoticeWords = { title: string; lateTitle: string; body: string };

function startWords(block: HeadsUpBlock, timeZone: string, voice: HeadsUpVoice, minutes: number): NoticeWords {
  const lead = minutesText(minutes);
  const at = timeAt(block.from, timeZone);
  const stops = voice === "apps" ? `Your apps pause at ${at}.` : `Your internet pauses at ${at}.`;
  if (block.afterExtraTime) return { title: `Your extra time ends in ${lead}`, lateTitle: `Your extra time ends at ${at}`, body: `${block.name} is back on. ${stops}` };
  return { title: `${block.name} starts in ${lead}`, lateTitle: `${block.name} starts at ${at}`, body: `Save your game and finish your messages. ${stops}` };
}

function endWords(block: HeadsUpBlock, timeZone: string, voice: HeadsUpVoice, minutes: number): NoticeWords {
  const lead = minutesText(minutes);
  const at = timeAt(block.to!, timeZone);
  const back = voice === "apps" ? `Your apps are back at ${at}.` : `Your internet is back at ${at}.`;
  if (block.endPause) return { title: `Your pause ends in ${lead}`, lateTitle: `Your pause ends at ${at}`, body: back };
  return { title: `${block.endName} ends in ${lead}`, lateTitle: `${block.endName} ends at ${at}`, body: back };
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
  /**
   * Whether the person can ask for more time on the block starting at `until`: a window on its
   * schedule, as the day offers it (`tellDay`). Not when it starts because extra time a parent gave
   * runs out, nor on a pause.
   */
  ask: boolean;
  /**
   * The one-line widget's words before its relative time: "Bedtime starts in", "Bedtime ends in",
   * "Your pause ends in"; with no `until` the whole line: "Paused · No end time", "Open · Nothing planned".
   */
  short: string;
  /** Whether the block named is the group's pause, which the widget draws with the pause sign rather than the block sign. */
  pause: boolean;
  /** The plan ran out while windows go on: the widget can't say what is next, and must not look open. */
  unknown: boolean;
};

/**
 * The widget's timeline from `now`: one entry for now, then one at each start and each end. With
 * `recurs` (the group has scheduled windows) blocks go on past the plan, so the last entry says the
 * widget is not up to date rather than "Nothing planned".
 */
export function headsUpTimeline(blocks: HeadsUpBlock[], now: Date, timeZone: string, recurs = false): HeadsUpEntry[] {
  const entries: (Omit<HeadsUpEntry, "short"> & { short?: string })[] = [];
  let at = now;
  for (const block of blocks) {
    if (block.from.getTime() > at.getTime()) {
      entries.push({ from: at, blocked: false, title: block.name, line: `Starts at ${timeAt(block.from, timeZone)}`, until: block.from, name: block.name, ask: !block.pause && !block.afterExtraTime, pause: block.pause, unknown: false });
    }
    const from = block.from.getTime() > at.getTime() ? block.from : at;
    const line = block.to ? `Ends at ${timeAt(block.to, timeZone)}` : NO_END_TIME;
    // A pause that ran into Bedtime is told as the pause until it is over, then as Bedtime.
    const switchAt = block.switchAt && block.switchAt.getTime() > from.getTime() ? block.switchAt : null;
    // Its one line names what ends it: the pause is over before then, so "Your pause ends in 11 hr" would be wrong.
    if (switchAt) entries.push({ from, blocked: true, title: block.name, line, until: block.to, name: block.name, ask: false, pause: block.pause, unknown: false, short: block.endPause ? "Your pause ends in" : `${block.endName} ends in` });
    const title = block.switchAt ? block.endName : block.name;
    entries.push({ from: switchAt ?? from, blocked: true, title, line, until: block.to, name: title, ask: false, pause: block.switchAt ? block.endPause : block.pause, unknown: false });
    if (!block.to) return entries.map(withShort);
    at = block.to;
  }
  entries.push(
    recurs
      ? { from: at, blocked: false, title: HEADS_UP_WORDS.unknownTitle, line: HEADS_UP_WORDS.unknownLine, until: null, name: null, ask: false, pause: false, unknown: true }
      : { from: at, blocked: false, title: OPEN_TITLE, line: "Nothing planned", until: null, name: null, ask: false, pause: false, unknown: false },
  );
  return entries.map(withShort);
}

/** The one-line widget's words for an entry (`HeadsUpEntry.short`). */
function withShort(entry: Omit<HeadsUpEntry, "short"> & { short?: string }): HeadsUpEntry {
  if (entry.short) return { ...entry, short: entry.short };
  if (!entry.until) return { ...entry, short: `${entry.title} · ${entry.line}` };
  if (!entry.blocked) return { ...entry, short: `${entry.title} starts in` };
  return { ...entry, short: entry.pause ? "Your pause ends in" : `${entry.title} ends in` };
}

const OPEN_TITLE = "Open";

/** "9 PM", "9:30 PM": the household's wall clock at `date`. */
function timeAt(date: Date, timeZone: string): string {
  const parts = zonedFormat({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return formatHhmm(`${get("hour")}:${get("minute")}`);
}
