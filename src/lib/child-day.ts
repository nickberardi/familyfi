import type { TimelineBand } from "@/lib/day-timeline";
import { formatHhmm } from "@/lib/display";
import { isWindowActive, nextWindowStart, windowDayBands, windowEndsAt, type RuleWindowSpec } from "@/lib/rule-windows";

/**
 * A child's day, as FamilyFi Me tells it on the child's phone: what blocks this phone or a Thing now, what comes later
 * today, and where asking fits. One rule for the phone and every Thing: during a pause the child
 * asks to end it, and a yes ends it (familyfi's unblock ends a pause); during a window (Bedtime,
 * Homework time) the child asks for 15 minutes, 30 minutes or 1 hour, and a yes allows that long
 * before the window carries on.
 *
 * Times are minutes after the household's midnight. A window that runs past midnight ends after
 * 1440 ("9 PM until 7 AM" is 1260 to 1860).
 */
export type Clock = number;

export type DayWindow = { label: string; from: Clock; to: Clock };

/**
 * What a line of the day shows beside it; each app draws its own symbol for it. `window` is the
 * window the line names (its `window`), which an app may draw by its name.
 */
export type DaySign = "pause" | "window" | "allowed" | "morning" | "waiting" | "declined";
export type DayPause = { by: string; from: Clock; to: Clock };
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
      minutes: AskLength;
      by: string;
    }
  | { kind: "open"; next?: DayWindow };

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
 * Windows are familyfi's rule windows (`RuleWindowSpec`, every day), read with familyfi's helpers on a
 * sample day in UTC, so FamilyFi Me tells a window's start, end and bands exactly as the parent's
 * apps do. TODO(K2): replace the sample day with the household's clock and time zone; `sampleDate`
 * is for FamilyFi Me's sample household only.
 */
const ZONE = "UTC";
const DAY_START = Date.UTC(2026, 10, 16);

/** The sample day's `minutes` as a Date, for DayTimeline. */
export const sampleDate = (minutes: Clock) => new Date(DAY_START + minutes * 60_000);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function hhmm(minutes: Clock): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function spec(window: DayWindow): RuleWindowSpec {
  return {
    name: window.label,
    days: EVERY_DAY,
    start: hhmm(window.from),
    end: hhmm(window.to),
  };
}

const at = sampleDate;
const minutesOf = (date: Date): Clock => Math.round((date.getTime() - DAY_START) / 60_000);

/** Whether a window covers `now`, including a window that started last night. */
function inWindow(window: DayWindow, now: Clock): boolean {
  return isWindowActive(spec(window), at(now), ZONE);
}

/** When the occurrence of `window` covering `now` ends: 7 AM today in its morning tail, 7 AM tomorrow at night. */
function endOf(window: DayWindow, now: Clock): Clock {
  const end = windowEndsAt(spec(window), at(now), ZONE);
  return end ? minutesOf(end) : window.to;
}

function windowBands(windows: DayWindow[]): TimelineBand[] {
  const weekday = new Date(DAY_START).getUTCDay();
  return windows.flatMap((window) =>
    windowDayBands(spec(window), weekday).map(({ from, to }): TimelineBand => ({
      kind: "window",
      from,
      to,
      label: window.label,
      source: "Every day",
    })),
  );
}

/** The first window that starts at or after `after` and before midnight. */
function firstWindowFrom(windows: DayWindow[], after: Clock): DayWindow | undefined {
  return windows
    .map((window) => {
      const start = nextWindowStart(spec(window), at(after - 1 / 60_000), ZONE);
      return start ? { window, from: minutesOf(start) } : undefined;
    })
    .filter((found): found is { window: DayWindow; from: Clock } => !!found && found.from < 1440)
    .sort((a, b) => a.from - b.from)[0]?.window;
}

/** Tells a day from what blocks it, the time now, and the child's request. */
export function tellDay(subject: DaySubject, now: Clock, voice: DayVoice): DayStory {
  // A no stands until the child can ask again; after that the Now block is askable again.
  const ask = subject.ask?.state === "no" && now >= subject.ask.answeredAt + ASK_AGAIN_AFTER ? undefined : subject.ask;
  const pause = subject.pause && now >= subject.pause.from && now < subject.pause.to ? subject.pause : undefined;
  const window = subject.windows.find((candidate) => inWindow(candidate, now));
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
  const afterWindow = (): DayItem[] => {
    if (windowEnd >= 1440)
      return [
        later({
          time: clock(windowEnd),
          tone: "on",
          sign: "morning",
          title: "Not blocked",
          detail: "Tomorrow morning",
        }),
      ];
    const next = nextWindow(windowEnd);
    return [notBlocked(windowEnd, next), ...(next ? [windowItem(next)] : [])];
  };
  // An allowance runs to the window's end at most, and is over once its time has passed.
  const allowedUntil =
    window && ask?.state === "yes" && ask.minutes ? Math.min(ask.answeredAt + ask.minutes, windowEnd) : undefined;
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

  const bands = windowBands(subject.windows);
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
      source: `By ${pause.by}`,
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
          text: voice.endDone(pause.by, clock(ended.answeredAt)),
        },
      },
      ...(next ? [windowItem(next)] : []),
    ];
    day = { kind: "unpaused", by: pause.by, next };
  } else if (pause && !ended) {
    bands.push({
      kind: "pause",
      from: pause.from,
      to: pause.to,
      label: voice.pauseWord,
      source: `By ${pause.by}`,
    });
    const next = nextWindow(pause.to);
    const covering = subject.windows.find((candidate) => inWindow(candidate, pause.to));
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
          title: `${voice.pauseWord} by ${pause.by}`,
          detail: `${clock(pause.from)} until ${clock(pause.to)}`,
        },
        false,
      ),
      // A window already on when the pause ends carries on; otherwise nothing blocks until the next.
      ...(covering
        ? [
            later({
              time: clock(pause.to),
              tone: "window",
              sign: "window",
              window: covering,
              title: covering.label,
              detail: `Until ${clock(endOf(covering, pause.to))}`,
            }),
          ]
        : [notBlocked(pause.to, next), ...(next ? [windowItem(next)] : [])]),
    ];
    day = { kind: "paused", pause, next };
  } else if (window && ask?.state === "yes" && ask.minutes && allowedUntil !== undefined && now < allowedUntil) {
    const until = allowedUntil;
    bands.push({
      kind: "allowance",
      from: ask.answeredAt,
      to: Math.min(until, 1440),
      label: "Allowed",
      source: `${ask.by} said yes`,
    });
    items = [
      {
        time: "Now",
        now: true,
        tone: "on",
        sign: "allowed",
        title: `Allowed until ${clock(until)}`,
        detail: `${ask.by} said yes to ${lengthText(ask.minutes)}`,
        status: {
          sign: "allowed",
          text: `Answered at ${clock(ask.answeredAt)}`,
        },
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
      minutes: ask.minutes,
      by: ask.by,
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
};

/** An Android phone's voice: FamilyFi blocks its internet at home, not its apps (no Screen Time there). */
export const INTERNET_VOICE: DayVoice = {
  ...PHONE_VOICE,
  whose: "your internet",
  endDone: (by, at) => `${by} unpaused your internet at ${at}.`,
};

/** A Thing's voice: it. */
export const THING_VOICE: DayVoice = {
  whose: "it",
  pauseWord: "Blocked",
  endAsk: "Ask to unblock",
  endWaiting: (at) => `You asked to unblock it at ${at}. Waiting for an answer.`,
  endDone: (by, at) => `${by} unblocked it at ${at}.`,
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
        title: `Paused until ${clock(day.pause.to)}`,
        sentence: `${day.pause.by} paused ${voice.whose}.`,
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
        sentence: `${day.by} said yes to ${lengthText(day.minutes)}.${day.until < day.end ? ` ${day.window.label} starts again at ${clock(day.until)}.` : ""}`,
      };
    case "open":
      return {
        sign: "allowed",
        tone: "on",
        title: "Nothing is blocked",
        sentence: day.next ? `${day.next.label} starts at ${clock(day.next.from)}.` : "Nothing is planned for today.",
      };
  }
}

/** A Thing's tile: its one word, the line under it, and its colour. */
export function thingTile({ day, ask }: DayStory): {
  word: string;
  line: string;
  tone: DayTone | "muted";
} {
  if (day.kind === "paused" || day.kind === "window") {
    if (ask?.state === "waiting")
      return {
        word: "You asked",
        line: "Waiting for an answer",
        tone: "muted",
      };
    const line =
      ask?.state === "no" ? "Not this time" : `Until ${clock(day.kind === "paused" ? day.pause.to : day.end)}`;
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
      ? `Blocked until ${clock(day.pause.to)}`
      : day.kind === "window"
        ? `${day.window.label} until ${clock(day.end)}`
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
