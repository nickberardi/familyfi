import type { TimelineBand } from "@/lib/day-timeline";
import { daysLabel, formatHhmm } from "@/lib/display";
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
 * asks to end it, and a yes ends it (familyfi's unblock ends a pause); during a window (Bedtime,
 * Homework time) the child asks for 15 minutes, 30 minutes or 1 hour, and a yes allows that long
 * before the window carries on.
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
  return pause.open && to === pause.to ? "no end time" : `until ${clock(to)}`;
}
export type AskLength = 15 | 30 | 60;
/**
 * A request and its answer: `at` is when it was sent, `answeredAt` when a parent answered, `by`
 * who. `minutes` is the length asked for during a window; a request to end a pause has none.
 */
export type DayAsk =
  | { state: "waiting"; at: Clock; minutes?: AskLength }
  | {
      state: "yes" | "no";
      at: Clock;
      answeredAt: Clock;
      by: string;
      minutes?: AskLength;
    };

export type DaySubject = {
  pause?: DayPause;
  windows: DayWindow[];
  ask?: DayAsk;
  /** The names of rules that block all internet all the time (an always-on internet rule). */
  always?: string[];
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
  endDone: (by: string, at: string) => string;
  /** The sentence for a pause FamilyFi has no person's name for: "Your apps are paused." */
  pausedByNoOne: string;
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
  | { kind: "unpaused"; by: string; next?: DayWindow }
  | {
      kind: "extended";
      window: DayWindow;
      until: Clock;
      end: Clock;
      /** The length a yes to the child's request gave; absent when a parent allowed it without one. */
      minutes?: AskLength;
      /** Who said yes, when FamilyFi has a person's name. */
      by?: string;
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

/** The askable lengths during a window. */
export const ASK_LENGTHS: { value: `${AskLength}`; label: string }[] = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
];

/** A child can ask again this long after a no. */
export const ASK_AGAIN_AFTER = 30;

/** "5 PM", "9:30 PM": familyfi's clock, for minutes after midnight. */
export function clock(minutes: Clock): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return formatHhmm(`${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`);
}

/** "15 more minutes", "1 more hour". */
export function lengthText(minutes: AskLength): string {
  return minutes === 60 ? "1 more hour" : `${minutes} more minutes`;
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
function wallMinutes(now: Date, timeZone: string): Clock {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
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
  const minutesOf = (date: Date): Clock => Math.round((date.getTime() - day.midnight.getTime()) / 60_000);
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
  const firstWindowFrom = (windows: DayWindow[], after: Clock): DayWindow | undefined =>
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
          if (lifted < end) return [{ ...window, from: lifted, to: end }];
          from = end;
        }
        return [];
      })
      .filter((found) => found.from < 1440)
      .sort((a, b) => a.from - b.from)[0];
  return { inWindow, endOf, windowBands, firstWindowFrom };
}

/**
 * A child's own day as FamilyFi reads it (`GET /api/v1/me/day`): the group the phone signs in for,
 * the household's time zone, the group's pause and allowance now, the windows of its internet rules
 * (`days` are the days a window starts on, 0 = Sunday; `start` and `end` are the household's
 * HH:mm, and an end at or before the start is the next morning), and the rules that block
 * something all the time.
 */
export type MeDay = {
  group: { id: string; name: string };
  timezone: string;
  /** `since` is when the pause was last set (started, or extended), not when it began: it places the band, and no start is told. `until` null: until a parent ends it. */
  pause: { by: string | null; since: string; until: string | null } | null;
  allowance: { by: string | null; until: string | null } | null;
  /** `allowed`: the window's rule is lifted for this group until a time (an allowance, or a rule paused or allowed). */
  windows: { ruleId: string; ruleName: string; name: string; days: number[]; start: string; end: string; allowed: { by: string | null; until: string } | null }[];
  alwaysOn: { ruleId: string; name: string; kind: "internet" | "category" | "app" | "domain" }[];
};

function minutesOfHhmm(value: string): Clock {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The child's phone's day from FamilyFi's answer, on the household's day: what `tellDay` tells.
 * A pause with no end is drawn to the end of today.
 */
export function meDaySubject(me: MeDay, now: Date): { subject: DaySubject; now: Clock; clock: DayClock } {
  const { clock, now: minutes } = householdDay(now, me.timezone);
  const minutesOf = (iso: string) => Math.round((new Date(iso).getTime() - clock.midnight.getTime()) / 60_000);
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
  const since = me.pause ? Math.min(minutesOf(me.pause.since), minutes) : 0;
  const pause = me.pause
    ? {
        ...(me.pause.by ? { by: me.pause.by } : {}),
        // A pause set before today is drawn from midnight.
        from: Math.max(0, since),
        ...(me.pause.until ? { to: minutesOf(me.pause.until) } : { to: 1440, open: true }),
      }
    : undefined;
  const always = me.alwaysOn.filter((rule) => rule.kind === "internet").map((rule) => rule.name);
  return { subject: { windows, ...(pause ? { pause } : {}), ...(always.length ? { always } : {}) }, now: minutes, clock };
}

/** Tells a day from what blocks it, the time now, and the child's request, on the household's day (the sample's by default). */
export function tellDay(subject: DaySubject, now: Clock, voice: DayVoice, on: DayClock = SAMPLE_CLOCK): DayStory {
  const { inWindow, endOf, windowBands, firstWindowFrom } = onDay(on);
  // A no stands until the child can ask again; after that the Now block is askable again.
  const ask = subject.ask?.state === "no" && now >= subject.ask.answeredAt + ASK_AGAIN_AFTER ? undefined : subject.ask;
  const pause = subject.pause && now >= subject.pause.from && now < subject.pause.to ? subject.pause : undefined;
  // A window a parent lifted gives way to another that still blocks now.
  const blocking = subject.windows.filter((candidate) => inWindow(candidate, now));
  const window = blocking.find((candidate) => !(candidate.allowed && now < candidate.allowed.until)) ?? blocking[0];
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
  const notBlocked = (at: Clock, next: DayWindow | undefined) =>
    later({
      time: clock(at),
      tone: "on",
      sign: "allowed",
      title: "Not blocked",
      detail: next ? `Until ${next.label}` : "For the rest of today",
    });
  // What comes from `start` on: a window on then carries on to its end (and any window overlapping
  // it after that), then nothing blocks until the next window or tomorrow morning.
  const onwards = (start: Clock): DayItem[] => {
    const items: DayItem[] = [];
    let at = start;
    for (let step = 0; step <= subject.windows.length; step++) {
      if (at >= 1440)
        return [
          ...items,
          later({ time: clock(at), tone: "on", sign: "morning", title: "Not blocked", detail: "Tomorrow morning" }),
        ];
      const covering = subject.windows.find((candidate) => inWindow(candidate, at));
      if (!covering) break;
      const end = endOf(covering, at);
      items.push(
        later({
          time: clock(at),
          tone: "window",
          sign: "window",
          window: covering,
          title: covering.label,
          detail: `Until ${clock(end)}`,
        }),
      );
      at = end;
    }
    const next = nextWindow(at);
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
    if (!ask)
      return {
        ...item,
        ask: {
          withLength,
          label: withLength ? "Ask for more time" : voice.endAsk,
        },
      };
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
          text: `${ask.by} said not this time. You can ask again at ${clock(ask.answeredAt + ASK_AGAIN_AFTER)}.`,
        },
      };
    return item;
  };

  const bands = windowBands(subject.windows, now);
  let day: Day;
  let items: DayItem[];
  let story = ask;
  // A yes ends the pause, and its band stops when it was answered. If a window is on by then,
  // the window case below tells the rest.
  const ended = pause && ask?.state === "yes" && !ask.minutes ? ask : undefined;
  if (pause && ended)
    bands.push({
      kind: "pause",
      from: pause.from,
      to: ended.answeredAt,
      label: voice.pauseWord,
      source: pause.by ? `By ${pause.by}` : voice.pauseWord,
      times: pauseTimes(pause, ended.answeredAt),
    });
  if (pause && ended && !window) {
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
  } else if (subject.always?.length) {
    // An always-on internet rule blocks all day, whatever the windows; asking about it comes with asking.
    const label = subject.always[0];
    bands.splice(0, bands.length, { kind: "window", from: 0, to: 1440, label, source: "All the time" });
    items = [{ time: "Now", now: true, tone: "window", sign: "window", title: label, detail: "All the time" }];
    day = { kind: "always", label };
    story = undefined;
  } else if (window && ((ask?.state === "yes" && ask.minutes && allowedUntil !== undefined && now < allowedUntil) || lift)) {
    const asked = ask?.state === "yes" && ask.minutes && allowedUntil !== undefined && now < allowedUntil ? { ...ask, minutes: ask.minutes } : undefined;
    const until = asked ? allowedUntil! : Math.min(lift!.until, windowEnd);
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
        detail: asked ? `${asked.by} said yes to ${lengthText(asked.minutes)}` : by ? `${by} said yes` : `${window.label} is off for now`,
        ...(asked ? { status: { sign: "allowed" as const, text: `Answered at ${clock(asked.answeredAt)}` } } : {}),
      },
      ...(until < windowEnd
        ? [
            later({
              time: clock(until),
              tone: "window",
              sign: "window",
              window,
              title: `${window.label} again`,
              detail: `Until ${clock(windowEnd)}`,
            }),
          ]
        : []),
      ...afterWindow(),
    ];
    day = {
      kind: "extended",
      window,
      until,
      end: windowEnd,
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
    items = [
      {
        time: "Now",
        now: true,
        tone: "on",
        sign: "allowed",
        title: "Not blocked",
        detail: next ? `Until ${clock(next.from)}` : "All day",
      },
      ...(next ? [windowItem(next)] : []),
    ];
    day = { kind: "open", next };
  }
  return { day, ask: story, bands, items, voice };
}

/** This phone's voice: its own apps. */
export const PHONE_VOICE: DayVoice = {
  whose: "your apps",
  pauseWord: "Paused",
  endAsk: "Ask to unpause",
  endWaiting: (at) => `You asked to be unpaused at ${at}. Waiting for an answer.`,
  endDone: (by, at) => `${by} unpaused your apps at ${at}.`,
  pausedByNoOne: "Your apps are paused.",
};

/** An Android phone's voice: FamilyFi blocks its internet at home, not its apps (no Screen Time there). */
export const INTERNET_VOICE: DayVoice = {
  ...PHONE_VOICE,
  whose: "your internet",
  endDone: (by, at) => `${by} unpaused your internet at ${at}.`,
  pausedByNoOne: "Your internet is paused.",
};

/** A Thing's voice: it. */
export const THING_VOICE: DayVoice = {
  whose: "it",
  pauseWord: "Blocked",
  endAsk: "Ask to unblock",
  endWaiting: (at) => `You asked to unblock it at ${at}. Waiting for an answer.`,
  endDone: (by, at) => `${by} unblocked it at ${at}.`,
  pausedByNoOne: "It is blocked.",
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
        sentence: `${day.by} unpaused ${voice.whose}.${day.next ? ` ${day.next.label} starts at ${clock(day.next.from)}.` : ""}`,
      };
    case "extended":
      return {
        sign: "allowed",
        tone: "on",
        title: `Allowed until ${clock(day.until)}`,
        sentence: `${extendedSentence(day)}${day.until < day.end ? ` ${day.window.label} starts again at ${clock(day.until)}.` : ""}`,
      };
    case "always":
      return { sign: "window", tone: "window", title: day.label, sentence: `${day.label} is on all the time.` };
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
  if (day.kind === "always") return { word: day.label, line: "All the time", tone: "window" };
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
    line: day.next ? `Until ${clock(day.next.from)}` : "All day",
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
          ? `${day.label} all the time`
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
      text: `Ask again at ${clock(ask.answeredAt + ASK_AGAIN_AFTER)}`,
    };
  return undefined;
}
