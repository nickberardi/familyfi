import { minutesText } from "@/lib/alert-copy";
import { zonedFormat } from "@/lib/clock";
import type { TimelineBand } from "@/lib/day-timeline";
import { daysLabel, formatHhmm } from "@/lib/display";
import { rulesToUnblock } from "@/lib/group-actions";
import { ASK_AHEAD_MINUTES, groupLift, rulePaused, type Rule, type RulePause } from "@/lib/rules";
import type { Actor, Group, GroupAsk } from "@/lib/types";
import {
  isWindowActive,
  localWeekday,
  nextWindowStart,
  windowDayBands,
  windowEndsAt,
  type RuleWindowSpec,
} from "@/lib/rule-windows";

/**
 * A child's day, as FamilyFi Me tells it on the child's phone: what blocks this phone or a Thing now, what comes later
 * today, and where asking fits. One rule for the phone and every Thing: during a pause the child
 * asks to end it, and a yes ends it (the group's resume); during a window (Bedtime, Homework time)
 * the child asks for some minutes (30, an hour, or a length of their own), and a yes allows that
 * long before the window carries on (the rule's allow for the group).
 *
 * Times are minutes after the household's midnight. A window that runs past midnight ends after
 * 1440 ("9 PM until 7 AM" is 1260 to 1860). A window runs on its `days` (0 = Sunday, the days it
 * starts on), every day when it names none, and is read on the household's own day (`DayClock`).
 */
export type Clock = number;

/**
 * `allowed`: a parent has lifted the window's rule for now, until `until` (today's minutes, later
 * than 1440 tomorrow); `by` who, when FamilyFi has a person's name.
 */
export type DayWindow = { label: string; from: Clock; to: Clock; days?: number[]; allowed?: { by?: string; until: Clock } };

/**
 * What a line of the day shows beside it; each app draws its own symbol for it. `window` is the
 * window the line names (its `window`), which an app may draw by its name.
 */
export type DaySign = "pause" | "window" | "allowed" | "morning" | "waiting" | "declined";
/**
 * `by` is who paused, as they were named then; absent when FamilyFi did not record a person.
 * `open`: the pause has no end time (it lasts until a parent ends it); `to` is then only where its
 * band stops drawing, and no time is told. `from` only places its band: FamilyFi knows when a pause
 * was last set, not when it began, so no start is told.
 */
export type DayPause = { by?: string; from: Clock; to: Clock; open?: boolean };

/** What a pause with no end time says where a time would go. */
export const NO_END_TIME = "No end time";

/** "Until 5 PM", or for a pause with no end "No end time". */
function pauseUntil(pause: DayPause): string {
  return pause.open ? NO_END_TIME : `Until ${clock(pause.to)}`;
}

/** A pause band's times, mid-sentence: only its end ("until 6 PM", "no end time"), never a start. */
function pauseTimes(pause: DayPause, to = pause.to): string {
  return pause.open && to === pause.to ? "with no end time" : `until ${clock(to)}`;
}
/** Minutes asked for during a window. */
export type AskLength = number;
/**
 * A request and its answer: `at` is when it was sent, `answeredAt` when a parent answered, `by`
 * who. `minutes` is the length asked for during a window; a request to end a pause has none.
 * After a no, `againAt` is when the child can ask again (FamilyFi's household wait). A request no
 * one answered in time is `timedOut`; one whose block ended first is `ended`.
 */
export type DayAsk =
  | { state: "waiting"; at: Clock; minutes?: AskLength }
  | {
      state: "yes" | "no";
      at: Clock;
      answeredAt: Clock;
      /** Who answered, when FamilyFi has a person's name. */
      by?: string;
      minutes?: AskLength;
      againAt?: Clock;
    }
  | { state: "timedOut" | "ended"; at: Clock; minutes?: AskLength };

export type DaySubject = {
  pause?: DayPause;
  windows: DayWindow[];
  ask?: DayAsk;
  /** Rules that block all internet all the time (an always-on internet rule); `allowed` while a parent lifted one until a time. */
  always?: { label: string; allowed?: { by?: string; until: Clock } }[];
};

/** The words that differ between this phone (your apps) and a Thing (it). */
export type DayVoice = {
  /** What a pause stops: "your apps" on an iPhone (Screen Time), "your internet" on Android, "it" for a Thing. */
  whose: string;
  /** "Paused" for the phone, "Blocked" for a Thing. */
  pauseWord: string;
  /** "Ask to unpause", "Ask to unblock". */
  endAsk: string;
  endWaiting: (at: string) => string;
  /** The pause ended by a yes; `by` absent when FamilyFi has no person's name. */
  endDone: (by: string | undefined, at: string) => string;
  /** The sentence for a pause FamilyFi has no person's name for: "Your apps are paused." */
  pausedByNoOne: string;
  /** The sentence for a pause ended with no person's name: "Your apps are unpaused." */
  unpausedByNoOne: string;
};

/** A state's colour: a pause in the paused ink, a window in plain ink (accent is for actions), allowed in green. */
export type DayTone = "paused" | "window" | "on";

export type DayItem = {
  /** "Now", or the time it starts. */
  time: string;
  now: boolean;
  tone: DayTone;
  sign: DaySign;
  /** The window a `window` sign names. */
  window?: DayWindow;
  title: string;
  detail: string;
  /** The Now block the child can ask from, and what the ask says. */
  ask?: { withLength: boolean; label: string };
  /** A request's state under the Now block. */
  status?: { text: string; sign: DaySign };
};

export type Day =
  | { kind: "paused"; pause: DayPause; next?: DayWindow }
  | { kind: "window"; window: DayWindow; end: Clock }
  | { kind: "unpaused"; by?: string; next?: DayWindow }
  | {
      kind: "extended";
      window: DayWindow;
      until: Clock;
      end: Clock;
      /** The length a yes to the child's request gave; absent when a parent allowed it without one. */
      minutes?: AskLength;
      /** Who said yes, when FamilyFi has a person's name. */
      by?: string;
      /** Another window that starts at `until`, cutting the allowed time short. */
      then?: DayWindow;
    }
  | { kind: "open"; next?: DayWindow }
  /** A rule blocks all internet all the time: `label` is its name. */
  | { kind: "always"; label: string };

export type DayStory = {
  day: Day;
  ask?: DayAsk;
  bands: TimelineBand[];
  items: DayItem[];
  voice: DayVoice;
};

/**
 * A length as one segment of the ask's switch shows it: "15m", "1h", "1h 45m", "4h".
 * Short so three segments fit one line on the smallest phone; screen readers and lists say `minutesText`.
 */
export function askLengthShort(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours}h` : "", rest ? `${rest}m` : ""].filter(Boolean).join(" ");
}

/** The askable lengths offered during a window, in full words and as a segment shows them; the child can also pick a length of their own. */
export const ASK_LENGTHS: { value: `${AskLength}`; label: string; short: string }[] = [
  { value: "30", label: "30 minutes", short: askLengthShort(30) },
  { value: "60", label: "1 hour", short: askLengthShort(60) },
];

/** The fewest and most minutes a child can ask for; FamilyFi refuses any other length. */
export const ASK_MINUTES = { min: 5, max: 240 } as const;

/** A length of the child's own is picked in steps this long. */
export const ASK_LENGTH_STEP = 15;

/** The third segment, beside the presets, that opens a length of the child's own; it opens a list, so it ends in an ellipsis. */
export const ASK_OTHER_LENGTH = "Other…";

/** The title of that list. */
export const ASK_LENGTH_TITLE = "How long";

/** What a screen reader says of the third segment once the child picked a length there: "Change length, 1 hour 30 minutes chosen". */
export function askLengthChosenLabel(minutes: number): string {
  return `Change length, ${minutesText(minutes)} chosen`;
}

/** Whether FamilyFi takes this many minutes as an ask. */
export function askLengthAllowed(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= ASK_MINUTES.min && minutes <= ASK_MINUTES.max;
}

/** The lengths of the child's own to pick from: every step up to the most, "15 minutes" to "4 hours". */
export function askLengthChoices(): { value: AskLength; label: string }[] {
  const choices: { value: AskLength; label: string }[] = [];
  for (let minutes = ASK_LENGTH_STEP; minutes <= ASK_MINUTES.max; minutes += ASK_LENGTH_STEP) {
    if (askLengthAllowed(minutes)) choices.push({ value: minutes, label: minutesText(minutes) });
  }
  return choices;
}

/** What the child's app says of a length FamilyFi would not take: "You can ask for 5 minutes to 4 hours." */
export const ASK_LENGTH_REFUSAL = `You can ask for ${minutesText(ASK_MINUTES.min)} to ${minutesText(ASK_MINUTES.max)}.`;

/** A child can ask again this long after a no, when FamilyFi does not say (`againAt`). */
export const ASK_AGAIN_AFTER = 30;

/** When the child can ask again after a no. */
function againAt(ask: { answeredAt: Clock; againAt?: Clock }): Clock {
  return ask.againAt ?? ask.answeredAt + ASK_AGAIN_AFTER;
}

/** "5 PM", "9:30 PM": familyfi's clock, for minutes after midnight. */
export function clock(minutes: Clock): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return formatHhmm(`${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`);
}

/** "15 more minutes", "1 more hour", "2 more hours", "1 hour 30 minutes more". */
export function lengthText(minutes: AskLength): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const restWord = rest === 1 ? "minute" : "minutes";
  if (!hours) return `${rest} more ${restWord}`;
  if (!rest) return hours === 1 ? "1 more hour" : `${hours} more hours`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${rest} ${restWord} more`;
}

/*
 * Windows are familyfi's rule windows (`RuleWindowSpec`), read with familyfi's helpers on the
 * household's day, so FamilyFi Me tells a window's start, end and bands exactly as the parent's apps do.
 */

/**
 * The day a story is told on: the household's time zone and the moment its day began. `Clock`
 * minutes count from `midnight`, so on the day the clocks change a time after the change is told an
 * hour off; every other day it is the household's wall clock.
 */
export type DayClock = { timeZone: string; midnight: Date };

const DAY_START = Date.UTC(2026, 10, 16);

/** FamilyFi Me's sample household: one fixed Monday in UTC. */
export const SAMPLE_CLOCK: DayClock = { timeZone: "UTC", midnight: new Date(DAY_START) };

/** The sample day's `minutes` as a Date, for DayTimeline. */
export const sampleDate = (minutes: Clock) => dayDate(SAMPLE_CLOCK, minutes);

/** `minutes` on a day as a Date, for DayTimeline. */
export function dayDate(day: DayClock, minutes: Clock): Date {
  return new Date(day.midnight.getTime() + minutes * 60_000);
}

/** Minutes after the household's midnight at `now`, by its wall clock. */
const WALL: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

function wallMinutes(now: Date, timeZone: string): Clock {
  const parts = zonedFormat(WALL, timeZone).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** The household's day `now` falls on, and how far into it `now` is. */
export function householdDay(now: Date, timeZone: string): { clock: DayClock; now: Clock } {
  const minutes = wallMinutes(now, timeZone);
  const startOfMinute = now.getTime() - (now.getTime() % 60_000);
  return { clock: { timeZone, midnight: new Date(startOfMinute - minutes * 60_000) }, now: minutes };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function hhmm(minutes: Clock): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function spec(window: DayWindow): RuleWindowSpec {
  return {
    name: window.label,
    days: window.days ?? EVERY_DAY,
    start: hhmm(window.from),
    end: hhmm(window.to),
  };
}

/** The window helpers, read on one household day. */
function onDay(day: DayClock) {
  const at = (minutes: Clock) => dayDate(day, minutes);
  const minutesOf = (date: Date): Clock => Math.floor((date.getTime() - day.midnight.getTime()) / 60_000);
  /** Whether a window covers `now`, including a window that started last night. */
  const inWindow = (window: DayWindow, now: Clock): boolean => isWindowActive(spec(window), at(now), day.timeZone);
  /** When the occurrence of `window` covering `now` ends: 7 AM today in its morning tail, 7 AM tomorrow at night. */
  const endOf = (window: DayWindow, now: Clock): Clock => {
    const end = windowEndsAt(spec(window), at(now), day.timeZone);
    return end ? minutesOf(end) : window.to;
  };
  // A window a parent lifted until a time blocks only after then: a band still to come starts there,
  // and is gone when the lift covers it. A band already over stays as it was.
  const windowBands = (windows: DayWindow[], now: Clock): TimelineBand[] => {
    const weekday = localWeekday(at(12 * 60), day.timeZone);
    return windows.flatMap((window) =>
      windowDayBands(spec(window), weekday).flatMap(({ from, to }): TimelineBand[] => {
        const start = window.allowed && to > now ? Math.max(from, Math.min(window.allowed.until, to)) : from;
        return start < to ? [{ kind: "window", from: start, to, label: window.label, source: daysLabel(window.days ?? EVERY_DAY) }] : [];
      }),
    );
  };
  /**
   * The first window that blocks at or after `after` and before midnight, as that occurrence runs today:
   * one a parent lifted past its start starts when the lift ends, and one the lift covers is skipped.
   */
  const firstWindowFrom = (windows: DayWindow[], after: Clock, before = 1440): DayWindow | undefined =>
    windows
      .flatMap((window) => {
        let from = after;
        // A window's next start, then the one after it while a lift covers the whole occurrence.
        for (let step = 0; step < 8; step++) {
          const found = nextWindowStart(spec(window), at(from - 1 / 60_000), day.timeZone);
          if (!found) return [];
          const start = minutesOf(found);
          const end = start + (window.to - window.from);
          const lifted = window.allowed && window.allowed.until > start ? Math.min(window.allowed.until, end) : start;
          if (lifted < end) return [{ told: { ...window, from: lifted, to: end }, start }];
          from = end;
        }
        return [];
      })
      // Today's occurrences (or up to `before`), even one a lift pushes past midnight.
      .filter((found) => found.start < before)
      .map((found) => found.told)
      .sort((a, b) => a.from - b.from)[0];
  return { inWindow, endOf, windowBands, firstWindowFrom };
}

/**
 * A child's own day as FamilyFi reads it (`groupDayOf`, from `GET /groups/{id}` and `GET /rules`): the group the phone signs in for,
 * the household's time zone, the group's pause and allowance now, the windows of its internet rules
 * (`days` are the days a window starts on, 0 = Sunday; `start` and `end` are the household's
 * HH:mm, and an end at or before the start is the next morning), and the rules that block
 * something all the time.
 */
export type GroupDay = {
  group: { id: string; name: string };
  timezone: string;
  /** `since`, when known, is when the pause was last set (started, or extended), not when it began: it places the band, and no start is told; without it the band starts now. `until` null: until a parent ends it. */
  pause: { by: string | null; since?: string; until: string | null } | null;
  allowance: { by: string | null; until: string | null } | null;
  /** `allowed`: the window's rule is lifted for this group until a time (an allowance, or a rule paused or allowed). */
  windows: { ruleId: string; ruleName: string; name: string; days: number[]; start: string; end: string; allowed: { by: string | null; until: string } | null }[];
  alwaysOn: { ruleId: string; name: string; kind: "internet" | "category" | "app" | "domain"; allowed: { by: string | null; until: string } | null }[];
  /** The group's latest ask for more time (`Group.ask`), with who answered by name. */
  ask?: (Omit<GroupAsk, "by"> & { by: string | null }) | null;
};

/**
 * A child's own day from what FamilyFi Me reads: its group (`GET /groups/{id}`), the rules that cover
 * it (`GET /rules`, which a child's phone gets for its own group alone) and the household's time zone
 * (`GET /auth/session`). The group's pause and allowance, the windows of its internet rules that are
 * on, and the rules that block something all the time. A rule paused or allowed, for everyone or for
 * this group, blocks nothing while it is lifted: a scheduled internet rule lifted until a time keeps
 * its windows, marked `allowed` until then, so the child is told when they come back, and an
 * always-on rule lifted until a time is marked the same way; one lifted with no end is left out.
 * FamilyFi names no person for the recovery account to a child's phone, so a `by` it sends as null
 * stays unnamed.
 */
export function groupDayOf(
  group: Pick<Group, "id" | "name" | "suspension" | "allowance" | "ask"> & Partial<Pick<Group, "kind" | "blockButtonRuleId">>,
  rules: Rule[],
  timezone: string,
  now: Date,
): GroupDay {
  const name = (by: Actor) => by?.name ?? null;
  // How long a rule is lifted for this group, for everyone or for it alone: the later end, null when
  // it has none; undefined when it is not lifted.
  const liftOf = (rule: Rule): RulePause | null | undefined => {
    const lifts = [rulePaused(rule, now) ? rule.pause : null, groupLift(rule, group.id, now)].filter((lift): lift is RulePause => lift !== null);
    if (!lifts.length) return undefined;
    if (lifts.some((lift) => lift.until === null)) return null;
    return lifts.reduce((a, b) => (new Date(a.until!).getTime() >= new Date(b.until!).getTime() ? a : b));
  };
  const allowedOf = (lift: RulePause | undefined) => (lift ? { by: name(lift.by), until: lift.until! } : null);
  const own = rules.filter((rule) => rule.enabled && rule.builtIn === null && (rule.groupIds ?? []).includes(group.id) && liftOf(rule) !== null);
  return {
    group: { id: group.id, name: group.name },
    timezone,
    pause: group.suspension.active ? { by: name(group.suspension.by), until: group.suspension.until } : buttonBlock(),
    allowance: group.allowance.active ? { by: name(group.allowance.by), until: group.allowance.until } : null,
    windows: own
      .filter((rule) => rule.kind === "internet" && rule.mode === "scheduled")
      .flatMap((rule) => {
        const allowed = allowedOf(liftOf(rule) ?? undefined);
        return (rule.windows ?? []).map((window) => ({ ruleId: rule.id, ruleName: rule.name, name: window.name, days: [...window.days].sort((a, b) => a - b), start: window.start, end: window.end, allowed }));
      }),
    alwaysOn: own.filter((rule) => rule.mode === "always").map((rule) => ({ ruleId: rule.id, name: rule.name, kind: rule.kind, allowed: allowedOf(liftOf(rule) ?? undefined) })),
    ask: group.ask ? { ...group.ask, by: name(group.ask.by ?? null) } : null,
  };

  // A Thing whose Block button rule (Video on TV) blocks it now reads Blocked, as its card does, and
  // the child can ask to unblock it, which a parent answers with the Thing's Unblock. It is told as
  // the Thing's block, with no one's name, until the rule stops blocking. A child's own phone is
  // told only its pause: Screen Time mirrors that as every app.
  function buttonBlock(): GroupDay["pause"] {
    if (group.kind !== "things" || !group.blockButtonRuleId) return null;
    const button = rulesToUnblock({ id: group.id, blockButtonRuleId: group.blockButtonRuleId }, rules, timezone, now).find((rule) => rule.ruleId === group.blockButtonRuleId);
    return button ? { by: null, until: button.until } : null;
  }
}

function minutesOfHhmm(value: string): Clock {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The child's phone's day from FamilyFi's answer, on the household's day: what `tellDay` tells.
 * A pause with no end is drawn to the end of today.
 */
export function meDaySubject(me: GroupDay, now: Date): { subject: DaySubject; now: Clock; clock: DayClock } {
  const { clock, now: minutes } = householdDay(now, me.timezone);
  const minutesOf = (iso: string) => Math.floor((new Date(iso).getTime() - clock.midnight.getTime()) / 60_000);
  const windows = me.windows.map((window): DayWindow => {
    const from = minutesOfHhmm(window.start);
    const end = minutesOfHhmm(window.end);
    return {
      label: window.name || window.ruleName,
      from,
      to: end <= from ? end + 1440 : end,
      days: window.days,
      ...(window.allowed ? { allowed: { ...(window.allowed.by ? { by: window.allowed.by } : {}), until: minutesOf(window.allowed.until) } } : {}),
    };
  });
  const since = me.pause ? Math.min(me.pause.since ? minutesOf(me.pause.since) : minutes, minutes) : 0;
  const pause = me.pause
    ? {
        ...(me.pause.by ? { by: me.pause.by } : {}),
        // A pause set before today is drawn from midnight.
        from: Math.max(0, since),
        ...(me.pause.until ? { to: minutesOf(me.pause.until) } : { to: 1440, open: true }),
      }
    : undefined;
  const always = me.alwaysOn
    .filter((rule) => rule.kind === "internet")
    .map((rule) => ({
      label: rule.name,
      ...(rule.allowed ? { allowed: { ...(rule.allowed.by ? { by: rule.allowed.by } : {}), until: minutesOf(rule.allowed.until) } } : {}),
    }))
    // Lifted for the rest of today: nothing to tell today.
    .filter((rule) => !rule.allowed || rule.allowed.until < 1440);
  // A request no one answered is told only while what it asked about still blocks.
  const stillOn = (ask: NonNullable<GroupDay["ask"]>) =>
    ask.state !== "timedOut" ||
    (ask.about === "pause"
      ? Boolean(me.pause)
      : me.windows.some((window) => window.ruleId === ask.ruleId && !window.allowed && isWindowActive(window, now, me.timezone)));
  // An ask about something, or in a state, this build does not know is not told.
  const ask = me.ask && knownAsk(me.ask) && stillOn(me.ask) ? answerNow(me.ask) : undefined;
  return { subject: { windows, ...(pause ? { pause } : {}), ...(always.length ? { always } : {}), ...(ask ? { ask } : {}) }, now: minutes, clock };

  // A yes is told only while what it gave is still so, and as long as it is now: the group's pause
  // and its rules' lifts are what hold, not what was asked for. A pause set again after a yes is a
  // new pause; a rule's lift for less, or more, than was asked is told as given, and once it is
  // over, or a parent took it back, the yes is not told.
  function answerNow(ask: KnownAsk): DayAsk | undefined {
    if (ask.state !== "yes") return dayAsk(ask, minutesOf);
    // A yes that ended a pause is told for the rest of the day it was answered on, never after.
    if (ask.about === "pause") {
      const answered = minutesOf(ask.answeredAt ?? ask.at);
      return !me.pause && answered >= 0 && answered <= minutes ? dayAsk(ask, minutesOf) : undefined;
    }
    const allowed = me.windows.find((window) => window.ruleId === ask.ruleId && window.allowed)?.allowed;
    if (!allowed || !ask.answeredAt) return undefined;
    const given = Math.round((new Date(allowed.until).getTime() - new Date(ask.answeredAt).getTime()) / 60_000);
    return given > 0 ? dayAsk({ ...ask, minutes: given }, minutesOf) : undefined;
  }
}

/** An ask whose `about` and `state` are ones this build knows; the API may add others. */
type KnownAsk = NonNullable<GroupDay["ask"]> & { about: "pause" | "rule"; state: DayAsk["state"] };
// A record, so a state DayAsk gains must be added here too.
const ASK_STATES: Record<DayAsk["state"], true> = { waiting: true, yes: true, no: true, timedOut: true, ended: true };

function knownAsk(ask: NonNullable<GroupDay["ask"]>): ask is KnownAsk {
  return (ask.about === "pause" || ask.about === "rule") && Object.hasOwn(ASK_STATES, ask.state);
}

/** FamilyFi's ask as the day tells it; a parent FamilyFi has no name for goes unnamed. */
function dayAsk(ask: KnownAsk, minutesOf: (iso: string) => Clock): DayAsk {
  const at = minutesOf(ask.at);
  const minutes = ask.minutes !== undefined ? { minutes: ask.minutes } : {};
  if (ask.state === "waiting" || ask.state === "timedOut" || ask.state === "ended") return { state: ask.state, at, ...minutes };
  return {
    state: ask.state,
    at,
    answeredAt: ask.answeredAt ? minutesOf(ask.answeredAt) : at,
    ...(ask.by ? { by: ask.by } : {}),
    ...minutes,
    ...(ask.askAgainAt ? { againAt: minutesOf(ask.askAgainAt) } : {}),
  };
}

/** Tells a day from what blocks it, the time now, and the child's request, on the household's day (the sample's by default). */
export function tellDay(subject: DaySubject, now: Clock, voice: DayVoice, on: DayClock = SAMPLE_CLOCK): DayStory {
  const { inWindow, endOf, windowBands, firstWindowFrom } = onDay(on);
  // A no stands until the child can ask again; after that the Now block is askable again.
  // A request whose block ended on its own is over.
  const ask =
    (subject.ask?.state === "no" && now >= againAt(subject.ask)) || subject.ask?.state === "ended" ? undefined : subject.ask;
  const pause = subject.pause && now >= subject.pause.from && now < subject.pause.to ? subject.pause : undefined;
  // A window a parent lifted gives way to another that still blocks now.
  const blocking = subject.windows.filter((candidate) => inWindow(candidate, now));
  // When every one is lifted, the one whose lift ends first is the one to tell.
  const liftEnd = (candidate: DayWindow) => Math.min(candidate.allowed?.until ?? now, endOf(candidate, now));
  const blockingAlways = subject.always?.find((rule) => !rule.allowed || now >= rule.allowed.until);
  const liftedAlways = subject.always?.filter((rule) => rule.allowed && now < rule.allowed.until).sort((a, b) => a.allowed!.until - b.allowed!.until)[0];
  const window =
    blocking.find((candidate) => !(candidate.allowed && now < candidate.allowed.until)) ??
    [...blocking].sort((a, b) => liftEnd(a) - liftEnd(b))[0];
  const windowEnd = window ? endOf(window, now) : 0;
  const nextWindow = (after: Clock) => firstWindowFrom(subject.windows, after);
  const later = (item: Omit<DayItem, "now">): DayItem => ({
    ...item,
    now: false,
  });
  const windowItem = (next: DayWindow) =>
    later({
      time: clock(next.from),
      tone: "window",
      sign: "window",
      window: next,
      title: next.label,
      detail: `Until ${clock(next.to)}`,
    });
  const notBlocked = (at: Clock, next: DayWindow | undefined, until = next?.label) =>
    later({
      time: clock(at),
      tone: "on",
      sign: "allowed",
      title: "Not blocked",
      detail: until ? `Until ${until}` : "For the rest of today",
    });
  // An always-on internet rule a parent lifted until `back`: from then it blocks for the rest of today.
  const back = liftedAlways?.allowed?.until;
  const alwaysAgain = (at: Clock) =>
    later({ time: clock(at), tone: "window", sign: "window", title: `${liftedAlways!.label} again`, detail: "For the rest of today" });
  // What comes from `start` on: a window on then carries on to its end (and any window overlapping
  // it after that), then nothing blocks until the next window or tomorrow morning.
  const onwards = (start: Clock, again?: DayWindow): DayItem[] => {
    // An always-on internet rule still on (after a pause) blocks from then, whatever the windows.
    if (blockingAlways) return [later({ time: clock(start), tone: "window", sign: "window", title: blockingAlways.label, detail: "For the rest of today" })];
    const items: DayItem[] = [];
    let at = start;
    // Past midnight: tomorrow morning is free, unless a lifted always-on rule has come back by then.
    const morning = () =>
      liftedAlways ? items : [...items, later({ time: clock(at), tone: "on", sign: "morning", title: "Not blocked", detail: "Tomorrow morning" })];
    for (let step = 0; step <= 3 * subject.windows.length; step++) {
      const covering = subject.windows.find((candidate) => inWindow(candidate, at) && !(candidate.allowed && at < candidate.allowed.until));
      if (!covering) {
        // A window a parent lifted part of blocks from when the lift ends; one lifted to its end, not at all.
        const resumed = subject.windows
          .filter((candidate) => inWindow(candidate, at) && candidate.allowed && candidate.allowed.until < endOf(candidate, at))
          .map((candidate) => ({ window: candidate, from: candidate.allowed!.until }))
          .sort((a, b) => a.from - b.from)[0];
        if (!resumed) {
          if (at >= 1440) return morning();
          break;
        }
        // Another window that starts before the lift ends is told first.
        const sooner = nextWindow(at);
        if (sooner && sooner.from < resumed.from) {
          items.push(notBlocked(at, sooner));
          at = sooner.from;
          continue;
        }
        // Its own line, even past midnight, then on from its end.
        const end = endOf(resumed.window, at);
        items.push(
          notBlocked(at, resumed.window),
          later({ time: clock(resumed.from), tone: "window", sign: "window", window: resumed.window, title: resumed.window.label, detail: `Until ${clock(end)}` }),
        );
        at = end;
        continue;
      }
      const end = endOf(covering, at);
      items.push(
        later({
          time: clock(at),
          tone: "window",
          sign: "window",
          window: covering,
          title: covering === again && at === start ? `${covering.label} again` : covering.label,
          detail: `Until ${clock(end)}`,
        }),
      );
      at = end;
    }
    if (at >= 1440) return morning();
    if (back !== undefined && back <= at) return [...items, alwaysAgain(at)];
    const next = nextWindow(at);
    if (back !== undefined && (!next || back < next.from)) return [...items, notBlocked(at, undefined, clock(back)), alwaysAgain(back)];
    return [...items, notBlocked(at, next), ...(next ? [windowItem(next)] : [])];
  };
  const afterWindow = () => onwards(windowEnd);
  // An allowance belongs to the window it was answered in: it runs to that window's end at most,
  // never carries over to a window that follows, and is over once its time has passed.
  const allowedUntil =
    window &&
    ask?.state === "yes" &&
    ask.minutes &&
    inWindow(window, ask.answeredAt) &&
    endOf(window, ask.answeredAt) === windowEnd
      ? Math.min(ask.answeredAt + ask.minutes, windowEnd)
      : undefined;
  // A parent lifted the window's rule without a request (an allowance, or the rule paused or allowed):
  // the window is allowed until then, and carries on after if it is still on.
  const lift = window?.allowed && now < window.allowed.until ? window.allowed : undefined;
  // The Now block: askable with no request, else the request's state under it.
  const withAskFor = (request: DayAsk | undefined, item: DayItem, withLength: boolean): DayItem => {
    const ask = request;
    const askable = { withLength, label: withLength ? "Ask for more time" : voice.endAsk };
    if (!ask) return { ...item, ask: askable };
    // No one answered in time: the child can ask again. Nobody said no, so it is not drawn as one.
    if (ask.state === "timedOut" || ask.state === "ended")
      return { ...item, ask: askable, status: { sign: "waiting", text: "No one answered in time. You can ask again." } };
    if (ask.state === "waiting")
      return {
        ...item,
        status: {
          sign: "waiting",
          text:
            withLength && ask.minutes
              ? `You asked for ${lengthText(ask.minutes)} at ${clock(ask.at)}. Waiting for an answer.`
              : voice.endWaiting(clock(ask.at)),
        },
      };
    if (ask.state === "no")
      return {
        ...item,
        status: {
          sign: "declined",
          text: `${ask.by ? `${ask.by} said not this time.` : "Not this time."} You can ask again at ${clock(againAt(ask))}.`,
        },
      };
    return item;
  };

  const bands = windowBands(subject.windows, now);
  let day: Day;
  let items: DayItem[];
  let story = ask;
  // A yes ends the pause, and its band stops when it was answered. If a window is on by then,
  // the window case below tells the rest. FamilyFi reports no pause once a parent ends it, so a
  // yes to unpause is told without one too, unless an always-on rule blocks, or is lifted, now.
  const ended =
    ask?.state === "yes" && !ask.minutes && (pause || (!blockingAlways && !liftedAlways)) ? ask : undefined;
  if (pause && ended)
    bands.push({
      kind: "pause",
      from: pause.from,
      to: ended.answeredAt,
      label: voice.pauseWord,
      source: pause.by ? `By ${pause.by}` : voice.pauseWord,
      times: pauseTimes(pause, ended.answeredAt),
    });
  if (ended && !window) {
    const next = nextWindow(now);
    items = [
      {
        time: "Now",
        now: true,
        tone: "on",
        sign: "allowed",
        title: "Not blocked",
        detail: next ? `Until ${next.label}` : "For the rest of today",
        status: {
          sign: "allowed",
          text: voice.endDone(ended.by, clock(ended.answeredAt)),
        },
      },
      ...(next ? [windowItem(next)] : []),
    ];
    day = { kind: "unpaused", by: ended.by, next };
  } else if (pause && !ended) {
    bands.push({
      kind: "pause",
      from: pause.from,
      to: pause.to,
      label: voice.pauseWord,
      source: pause.by ? `By ${pause.by}` : voice.pauseWord,
      times: pauseTimes(pause),
    });
    const next = pause.open ? undefined : nextWindow(pause.to);
    // Only a request to unpause (no length) belongs to a pause; a window's request does not.
    const current = ask?.minutes ? undefined : ask;
    story = current;
    items = [
      withAskFor(
        current,
        {
          time: "Now",
          now: true,
          tone: "paused",
          sign: "pause",
          title: pause.by ? `${voice.pauseWord} by ${pause.by}` : voice.pauseWord,
          detail: pauseUntil(pause),
        },
        false,
      ),
      // A window already on when the pause ends carries on; otherwise nothing blocks until the next.
      // A pause with no end has no later today to tell.
      ...(pause.open ? [] : onwards(pause.to)),
    ];
    day = { kind: "paused", pause, next };
  } else if (blockingAlways) {
    // An always-on internet rule blocks all day, whatever the windows. A child can't ask about it yet:
    // asking (familyfi PR 2) covers a pause and a window.
    const label = blockingAlways.label;
    bands.splice(0, bands.length, { kind: "window", from: 0, to: 1440, label, source: "No internet", times: "All day" });
    items = [{ time: "Now", now: true, tone: "window", sign: "window", title: label, detail: "All day" }];
    day = { kind: "always", label };
    story = undefined;
  } else if (liftedAlways && !(window && !(window.allowed && now < window.allowed.until))) {
    // Lifted for now: allowed until then, or until a window starts first, and no internet from then on.
    const { label, allowed } = liftedAlways;
    const by = allowed!.by;
    // The window on now, lifted for less than its length, blocks again when its own lift ends.
    const resumes = window?.allowed && now < window.allowed.until && window.allowed.until < windowEnd ? { ...window, from: window.allowed.until } : undefined;
    const upcoming = nextWindow(now);
    const sooner = resumes && (!upcoming || resumes.from <= upcoming.from) ? resumes : upcoming;
    const then = sooner && sooner.from < back! ? sooner : undefined;
    const until = then ? then.from : back!;
    bands.push({ kind: "window", from: back!, to: 1440, label, source: "No internet", times: `from ${clock(back!)}` });
    items = [
      { time: "Now", now: true, tone: "on", sign: "allowed", title: `Allowed until ${clock(until)}`, detail: by ? `${by} said yes` : `${label} is off for now` },
      ...(then ? onwards(then.from) : [alwaysAgain(back!)]),
    ];
    day = { kind: "extended", window: { label, from: 0, to: 1440 }, until, end: 1440, ...(by ? { by } : {}), ...(then ? { then } : {}) };
  } else if (window && ((ask?.state === "yes" && ask.minutes && allowedUntil !== undefined && now < allowedUntil) || lift)) {
    const asked = ask?.state === "yes" && ask.minutes && allowedUntil !== undefined && now < allowedUntil ? { ...ask, minutes: ask.minutes } : undefined;
    const allowedTo = asked ? allowedUntil! : Math.min(lift!.until, windowEnd);
    // Another window that blocks before then ends the allowed time there.
    const sooner = firstWindowFrom(
      subject.windows.filter((other) => other !== window),
      now,
      Math.max(1440, allowedTo),
    );
    const then = sooner && sooner.from < allowedTo ? sooner : undefined;
    const until = then ? then.from : allowedTo;
    const by = asked ? asked.by : lift!.by;
    // A lift has no answer time: its band covers the window up to then.
    const occurrence = Math.max(0, windowEnd - (window.to - window.from));
    bands.push({
      kind: "allowance",
      from: asked ? asked.answeredAt : occurrence,
      to: Math.min(until, 1440),
      label: "Allowed",
      source: by ? `${by} said yes` : "Allowed",
    });
    items = [
      {
        time: "Now",
        now: true,
        tone: "on",
        sign: "allowed",
        title: `Allowed until ${clock(until)}`,
        detail: asked
          ? asked.by
            ? `${asked.by} said yes to ${lengthText(asked.minutes)}`
            : `You got ${lengthText(asked.minutes)}`
          : by
            ? `${by} said yes`
            : `${window.label} is off for now`,
        ...(asked ? { status: { sign: "allowed" as const, text: `Answered at ${clock(asked.answeredAt)}` } } : {}),
      },
      ...onwards(until, window),
    ];
    day = {
      kind: "extended",
      window,
      until,
      end: windowEnd,
      ...(then ? { then } : {}),
      ...(asked ? { minutes: asked.minutes } : {}),
      ...(by ? { by } : {}),
    };
  } else if (window) {
    // An allowance whose time has passed leaves the window as it was, and the child can ask again.
    // A request to unpause (no length) doesn't belong to a window either.
    const current = ask?.state === "yes" || !ask?.minutes ? undefined : ask;
    items = [
      withAskFor(
        current,
        {
          time: "Now",
          now: true,
          tone: "window",
          sign: "window",
          window,
          title: window.label,
          detail: `${clock(window.from)} until ${clock(windowEnd)}`,
        },
        true,
      ),
      ...afterWindow(),
    ];
    day = { kind: "window", window, end: windowEnd };
    story = current;
  } else {
    const next = nextWindow(now);
    const open: DayItem = {
      time: "Now",
      now: true,
      tone: "on",
      sign: "allowed",
      title: "Not blocked",
      detail: next ? `Until ${clock(next.from)}` : "For the rest of today",
    };
    // In the heads-up's last minutes before a window starts (familyfi#457), the child can already ask
    // for more time on it, as FamilyFi takes it (`askableWindows`); not on one a parent already lifted.
    const soon = next && !next.allowed && next.from > now && next.from - now <= ASK_AHEAD_MINUTES;
    const current = soon && ask?.state !== "yes" && ask?.minutes ? ask : undefined;
    items = [soon ? withAskFor(current, open, true) : open, ...(next ? [windowItem(next)] : [])];
    day = { kind: "open", next };
    if (soon) story = current;
  }
  return { day, ask: story, bands, items, voice };
}

/** This phone's voice: its own apps. */
export const PHONE_VOICE: DayVoice = {
  whose: "your apps",
  pauseWord: "Paused",
  endAsk: "Ask to unpause",
  endWaiting: (at) => `You asked to be unpaused at ${at}. Waiting for an answer.`,
  endDone: (by, at) => (by ? `${by} unpaused your apps at ${at}.` : `Your apps were unpaused at ${at}.`),
  pausedByNoOne: "Your apps are paused.",
  unpausedByNoOne: "Your apps are unpaused.",
};

/** An Android phone's voice: FamilyFi blocks its internet at home, not its apps (no Screen Time there). */
export const INTERNET_VOICE: DayVoice = {
  ...PHONE_VOICE,
  whose: "your internet",
  endDone: (by, at) => (by ? `${by} unpaused your internet at ${at}.` : `Your internet was unpaused at ${at}.`),
  pausedByNoOne: "Your internet is paused.",
  unpausedByNoOne: "Your internet is unpaused.",
};

/** A Thing's voice: it. */
export const THING_VOICE: DayVoice = {
  whose: "it",
  pauseWord: "Blocked",
  endAsk: "Ask to unblock",
  endWaiting: (at) => `You asked to unblock it at ${at}. Waiting for an answer.`,
  endDone: (by, at) => (by ? `${by} unblocked it at ${at}.` : `It was unblocked at ${at}.`),
  pausedByNoOne: "It is blocked.",
  unpausedByNoOne: "It is unblocked.",
};

/**
 * Apple keeps these working whatever FamilyFi Me blocks; a general statement, not a list we read.
 * iPhone and iPad only: the home screen adds it under a blocked answer there.
 */
export const ALWAYS_WORK = "Phone, Messages, FaceTime and Maps still work.";

export type TopAnswer = {
  sign: DaySign;
  window?: DayWindow;
  tone: DayTone;
  title: string;
  sentence: string;
};

/** The one big answer at the top of the home screen. */
export function topAnswer({ day, voice }: DayStory): TopAnswer {
  switch (day.kind) {
    case "paused":
      return {
        sign: "pause",
        tone: "paused",
        title: day.pause.open ? voice.pauseWord : `${voice.pauseWord} until ${clock(day.pause.to)}`,
        sentence: day.pause.by ? `${day.pause.by} paused ${voice.whose}.` : voice.pausedByNoOne,
      };
    case "window":
      return {
        sign: "window",
        window: day.window,
        tone: "window",
        title: `${day.window.label} until ${clock(day.end)}`,
        sentence: `${day.window.label} has started.`,
      };
    case "unpaused":
      return {
        sign: "allowed",
        tone: "on",
        title: day.next ? `Not blocked until ${clock(day.next.from)}` : "Not blocked",
        sentence: `${day.by ? `${day.by} unpaused ${voice.whose}.` : voice.unpausedByNoOne}${day.next ? ` ${day.next.label} starts at ${clock(day.next.from)}.` : ""}`,
      };
    case "extended":
      return {
        sign: "allowed",
        tone: "on",
        title: `Allowed until ${clock(day.until)}`,
        sentence: `${extendedSentence(day)}${
          day.then ? ` ${day.then.label} starts at ${clock(day.until)}.` : day.until < day.end ? ` ${day.window.label} starts again at ${clock(day.until)}.` : ""
        }`,
      };
    case "always":
      return { sign: "window", tone: "window", title: day.label, sentence: "No internet all day." };
    case "open":
      return {
        sign: "allowed",
        tone: "on",
        title: "Nothing is blocked",
        sentence: day.next ? `${day.next.label} starts at ${clock(day.next.from)}.` : "Nothing is planned for today.",
      };
  }
}

/** "Dad said yes to 30 more minutes.", "Dad said yes.", or with no name "Bedtime is off for now." */
function extendedSentence(day: Extract<Day, { kind: "extended" }>): string {
  if (!day.by) return `${day.window.label} is off for now.`;
  return day.minutes ? `${day.by} said yes to ${lengthText(day.minutes)}.` : `${day.by} said yes.`;
}

/** A Thing's tile: its one word, the line under it, and its colour. */
export function thingTile({ day, ask }: DayStory): {
  word: string;
  line: string;
  tone: DayTone | "muted";
} {
  if (day.kind === "always") return { word: day.label, line: "All day", tone: "window" };
  if (day.kind === "paused" || day.kind === "window") {
    if (ask?.state === "waiting")
      return {
        word: "You asked",
        line: "Waiting for an answer",
        tone: "muted",
      };
    const line =
      ask?.state === "no" ? "Not this time" : day.kind === "paused" ? pauseUntil(day.pause) : `Until ${clock(day.end)}`;
    return day.kind === "paused"
      ? { word: "Blocked", line, tone: "paused" }
      : { word: day.window.label, line, tone: "window" };
  }
  if (day.kind === "extended") return { word: "Allowed", line: `Until ${clock(day.until)}`, tone: "on" };
  // Unpaused or open: nothing blocks it now.
  return {
    word: "Not blocked",
    line: day.next ? `Until ${clock(day.next.from)}` : "For the rest of today",
    tone: "on",
  };
}

/** The sentence under a Thing's name in its sheet. */
export function thingNote({ day, ask, items }: DayStory): string {
  const blocked =
    day.kind === "paused"
      ? day.pause.open
        ? "Blocked with no end time"
        : `Blocked until ${clock(day.pause.to)}`
      : day.kind === "window"
        ? `${day.window.label} until ${clock(day.end)}`
        : day.kind === "always"
          ? /internet/i.test(day.label)
            ? `${day.label} all day`
            : `${day.label}: no internet all day`
          : "";
  if (items.some((item) => item.ask)) return `${blocked}. Ask here and your parents decide.`;
  if (ask?.state === "waiting" && blocked) return `${blocked}. Waiting for an answer.`;
  if (blocked) return `${blocked}.`;
  if (day.kind === "extended") return `Allowed until ${clock(day.until)}.`;
  return "next" in day && day.next ? `Not blocked until ${clock(day.next.from)}.` : "Not blocked today.";
}

/** The short line beside "See my day" while a request waits, or after a no until the child can ask again. */
export function askNote({ day, ask }: DayStory): { sign: DaySign; text: string } | undefined {
  if (day.kind !== "paused" && day.kind !== "window") return undefined;
  if (ask?.state === "waiting") return { sign: "waiting", text: "Waiting for an answer" };
  if (ask?.state === "no")
    return {
      sign: "declined",
      text: `Ask again at ${clock(againAt(ask))}`,
    };
  return undefined;
}
