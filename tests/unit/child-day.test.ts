import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { bandTimes, timelineLegend } from "@/lib/day-timeline";
import type { Rule } from "@/lib/rules";

import {
  ASK_LENGTH_REFUSAL,
  ASK_LENGTH_STEP,
  ASK_MINUTES,
  ASK_LENGTHS,
  ASK_LENGTH_TITLE,
  ASK_OTHER_LENGTH,
  askLengthChosenLabel,
  askLengthShort,
  INTERNET_VOICE,
  askLengthAllowed,
  askLengthChoices,
  PHONE_VOICE,
  THING_VOICE,
  clock,
  tellDay,
  thingNote,
  thingTile,
  topAnswer,
  askNote,
  householdDay,
  meDaySubject,
  groupDayOf,
  lengthText,
  type DaySubject,
  type GroupDay,
} from "@/lib/child-day";

const BEDTIME = { label: "Bedtime", from: 21 * 60, to: 31 * 60 };
const paused: DaySubject = {
  pause: { by: "Dad", from: 15 * 60 + 30, to: 17 * 60 },
  windows: [BEDTIME],
};
const NOW = 15 * 60 + 45;

describe("a child's day", () => {
  it("reads times as familyfi does", () => {
    expect(clock(17 * 60)).toBe("5 PM");
    expect(clock(21 * 60 + 30)).toBe("9:30 PM");
    expect(clock(31 * 60)).toBe("7 AM");
  });

  // familyfi#457: the heads-up's countdown offers Ask for more time before the window starts.
  it("lets the child ask for more time in the last five minutes before a window starts", () => {
    const soon = tellDay({ windows: [BEDTIME] }, 21 * 60 - 3, PHONE_VOICE);
    expect(soon.day.kind).toBe("open");
    expect(soon.items[0]).toMatchObject({ now: true, title: "Not blocked", ask: { withLength: true, label: "Ask for more time" } });
    expect(tellDay({ windows: [BEDTIME] }, 21 * 60 - 10, PHONE_VOICE).items[0]!.ask).toBeUndefined();
    const waiting = tellDay({ windows: [BEDTIME], ask: { state: "waiting", at: 21 * 60 - 4, minutes: 30 } }, 21 * 60 - 3, PHONE_VOICE);
    // A window starting at midnight is tomorrow's, and still askable at 11:57 PM.
    const midnight = tellDay({ windows: [{ label: "Night", from: 0, to: 7 * 60 }] }, 24 * 60 - 3, PHONE_VOICE);
    expect(midnight.items[0]!.ask).toMatchObject({ label: "Ask for more time" });
    // As early as the household's heads-up: 8 minutes out with 10, and never with it off.
    expect(tellDay({ windows: [BEDTIME], askAhead: 10 }, 21 * 60 - 8, PHONE_VOICE).items[0]!.ask).toBeDefined();
    expect(tellDay({ windows: [BEDTIME], askAhead: 0 }, 21 * 60 - 1, PHONE_VOICE).items[0]!.ask).toBeUndefined();
    expect(waiting.items[0]!.status?.text).toBe("You asked for 30 more minutes at 8:56 PM. Waiting for an answer.");
  });

  it("asks to unpause during a pause, for a length", () => {
    const story = tellDay(paused, NOW, PHONE_VOICE);
    expect(story.day.kind).toBe("paused");
    expect(story.items[0]).toMatchObject({
      now: true,
      title: "Paused by Dad",
      ask: { withLength: true, label: "Ask to unpause" },
    });
    expect(topAnswer(story)).toMatchObject({
      title: "Paused until 5 PM",
      sentence: "Dad paused your apps.",
    });
  });

  // familyfi's unblock ends a pause (docs/group-states.md): a yes to an ask with no length is never
  // "30 minutes, then paused again"; a yes for a length gives a break (below).
  it("ends the pause on a yes", () => {
    const story = tellDay(
      {
        ...paused,
        ask: { state: "yes", at: NOW - 5, answeredAt: NOW - 2, by: "Dad" },
      },
      NOW,
      PHONE_VOICE,
    );
    expect(story.day.kind).toBe("unpaused");
    expect(story.bands.find((band) => band.kind === "pause")).toMatchObject({
      from: 15 * 60 + 30,
      to: NOW - 2,
    });
    expect(story.items.map((item) => item.title)).toEqual(["Not blocked", "Bedtime"]);
    expect(topAnswer(story).title).toBe("Not blocked until 9 PM");
  });

  it("lets a window or an always-on rule tell the day after a yes ended a pause", () => {
    const yes = { state: "yes" as const, at: 20 * 60, answeredAt: 20 * 60 + 5, by: "Mom" };
    expect(tellDay({ windows: [BEDTIME], ask: yes }, 21 * 60 + 30, PHONE_VOICE).day.kind).toBe("window");
    expect(tellDay({ windows: [], always: [{ label: "Grounded" }], ask: yes }, 21 * 60, PHONE_VOICE).day.kind).toBe("always");
    const lifted = tellDay({ windows: [], always: [{ label: "Grounded", allowed: { by: "Dad", until: 22 * 60 } }], ask: yes }, 21 * 60, PHONE_VOICE);
    expect(lifted.day.kind).not.toBe("unpaused");
    expect(tellDay({ windows: [], ask: yes }, 21 * 60, PHONE_VOICE).day.kind).toBe("unpaused");
  });

  it("names the parent who answered, not the one who paused", () => {
    const story = tellDay({ ...paused, ask: { state: "yes", at: NOW - 5, answeredAt: NOW - 2, by: "Mom" } }, NOW, PHONE_VOICE);
    expect(topAnswer(story).sentence).toMatch(/^Mom unpaused your apps\./);
  });

  it("asks for a length during a window, and allows that long before the window carries on", () => {
    const window = tellDay({ windows: [BEDTIME] }, 21 * 60, PHONE_VOICE);
    expect(window.items[0]?.ask).toEqual({
      withLength: true,
      label: "Ask for more time",
    });
    const yes = tellDay(
      {
        windows: [BEDTIME],
        ask: {
          state: "yes",
          at: 21 * 60,
          answeredAt: 21 * 60,
          minutes: 30,
          by: "Dad",
        },
      },
      21 * 60,
      PHONE_VOICE,
    );
    expect(yes.day).toMatchObject({ kind: "extended", until: 21 * 60 + 30 });
    expect(yes.items.map((item) => item.title)).toEqual(["Allowed until 9:30 PM", "Bedtime again", "Not blocked"]);
    expect(yes.bands.find((band) => band.kind === "allowance")).toMatchObject({
      from: 21 * 60,
      to: 21 * 60 + 30,
    });
  });

  it("splits a window past midnight into tonight and this morning", () => {
    const story = tellDay({ windows: [BEDTIME] }, 6 * 60, PHONE_VOICE);
    expect(story.day.kind).toBe("window");
    expect(story.bands).toEqual([
      expect.objectContaining({ kind: "window", from: 0, to: 7 * 60 }),
      expect.objectContaining({ kind: "window", from: 21 * 60, to: 1440 }),
    ]);
  });

  it("ends this morning's Bedtime at 7 AM today and lists tonight's", () => {
    const story = tellDay({ windows: [BEDTIME] }, 6 * 60, PHONE_VOICE);
    expect(topAnswer(story).title).toBe("Bedtime until 7 AM");
    expect(story.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Bedtime"],
      ["7 AM", "Not blocked"],
      ["9 PM", "Bedtime"],
    ]);
  });

  it("keeps a yes inside the window and ends it when its time has passed", () => {
    const late = { ...BEDTIME, from: 21 * 60, to: 22 * 60 };
    const yes = (now: number) =>
      tellDay(
        {
          windows: [late],
          ask: {
            state: "yes",
            at: 21 * 60 + 30,
            answeredAt: 21 * 60 + 35,
            by: "Dad",
            minutes: 60,
          },
        },
        now,
        PHONE_VOICE,
      );
    const during = yes(21 * 60 + 40);
    expect(during.day).toMatchObject({ kind: "extended", until: 22 * 60 });
    expect(during.items.map((item) => item.title)).toEqual(["Allowed until 10 PM", "Not blocked"]);
    expect(topAnswer(during).sentence).toBe("Dad said yes to 1 more hour.");

    const short = tellDay(
      {
        windows: [BEDTIME],
        ask: {
          state: "yes",
          at: 21 * 60,
          answeredAt: 21 * 60 + 5,
          by: "Dad",
          minutes: 15,
        },
      },
      21 * 60 + 30,
      PHONE_VOICE,
    );
    expect(short.day.kind).toBe("window");
    expect(short.ask).toBeUndefined();
    expect(short.items[0]?.ask).toMatchObject({ withLength: true });
  });

  it("says when a child can ask again after a no", () => {
    const story = tellDay(
      {
        ...paused,
        ask: { state: "no", at: NOW - 5, answeredAt: NOW, by: "Dad" },
      },
      NOW,
      PHONE_VOICE,
    );
    expect(story.items[0]?.ask).toBeUndefined();
    expect(story.items[0]?.status?.text).toBe("Dad said not this time. You can ask again at 4:15 PM.");
  });

  it("asks again when FamilyFi says, after no one answered in time, and not about a block that ended", () => {
    const declined = tellDay({ ...paused, ask: { state: "no", at: NOW - 5, answeredAt: NOW, by: "Dad", againAt: NOW + 60 } }, NOW + 45, PHONE_VOICE);
    expect(declined.items[0]?.status?.text).toBe("Dad said not this time. You can ask again at 4:45 PM.");
    expect(declined.items[0]?.ask).toBeUndefined();
    const lapsed = tellDay({ ...paused, ask: { state: "timedOut", at: NOW - 60 } }, NOW, PHONE_VOICE);
    expect(lapsed.items[0]?.status?.text).toBe("No one answered in time. You can ask again.");
    expect(lapsed.items[0]?.ask).toMatchObject({ withLength: true, label: "Ask to unpause" });
    const ended = tellDay({ ...paused, ask: { state: "ended", at: NOW - 60 } }, NOW, PHONE_VOICE);
    expect(ended.ask).toBeUndefined();
    expect(ended.items[0]?.status).toBeUndefined();
  });

  it("says any length a child asked for", () => {
    expect([15, 30, 60, 90, 120].map(lengthText)).toEqual(["15 more minutes", "30 more minutes", "1 more hour", "1 hour 30 minutes more", "2 more hours"]);
    expect([1, 61].map(lengthText)).toEqual(["1 more minute", "1 hour 1 minute more"]);
  });

  it("tells a Thing's day in its own words", () => {
    const thing: DaySubject = {
      pause: { by: "Mom", from: 15 * 60, to: 18 * 60 },
      windows: [BEDTIME],
    };
    const story = tellDay(thing, NOW, THING_VOICE);
    expect(story.items[0]).toMatchObject({
      title: "Blocked by Mom",
      ask: { label: "Ask to unblock" },
    });
    expect(thingTile(story)).toEqual({
      word: "Blocked",
      line: "Until 6 PM",
      tone: "paused",
    });
    expect(thingNote(story)).toBe("Blocked until 6 PM. Ask here and your parents decide.");
    const waiting = tellDay({ ...thing, ask: { state: "waiting", at: NOW } }, NOW, THING_VOICE);
    expect(thingTile(waiting)).toEqual({
      word: "You asked",
      line: "Waiting for an answer",
      tone: "muted",
    });
  });

  it("signs each line for the app to draw", () => {
    const story = tellDay(paused, NOW, PHONE_VOICE);
    expect(story.items.map((item) => item.sign)).toEqual(["pause", "allowed", "window"]);
    expect(story.items[2]?.window).toEqual(BEDTIME);
    expect(topAnswer(tellDay({ windows: [BEDTIME] }, 22 * 60, PHONE_VOICE))).toMatchObject({
      sign: "window",
      window: BEDTIME,
    });
  });

  it("notes a waiting request and when a child can ask again", () => {
    expect(askNote(tellDay({ ...paused, ask: { state: "waiting", at: NOW } }, NOW, PHONE_VOICE))).toEqual({
      sign: "waiting",
      text: "Waiting for an answer",
    });
    const no: DaySubject = {
      ...paused,
      ask: { state: "no", at: NOW - 5, answeredAt: NOW, by: "Dad" },
    };
    expect(askNote(tellDay(no, NOW, PHONE_VOICE))).toEqual({
      sign: "declined",
      text: "Ask again at 4:15 PM",
    });
    expect(askNote(tellDay(paused, NOW, PHONE_VOICE))).toBeUndefined();
    // A request still waiting once the pause has ended has nothing left to unblock.
    expect(
      askNote(tellDay({ ...paused, ask: { state: "waiting", at: NOW } }, 17 * 60 + 5, PHONE_VOICE)),
    ).toBeUndefined();
  });

  it("lets the child ask again once the ask-again time comes", () => {
    const subject: DaySubject = {
      ...paused,
      ask: { state: "no", at: NOW - 5, answeredAt: NOW, by: "Dad" },
    };
    expect(tellDay(subject, NOW + 29, PHONE_VOICE).items[0]?.ask).toBeUndefined();
    const later = tellDay(subject, NOW + 30, PHONE_VOICE);
    expect(later.ask).toBeUndefined();
    expect(later.items[0]).toMatchObject({
      ask: { withLength: true, label: "Ask to unpause" },
    });
  });

  it("lists a window that is already on when a pause ends", () => {
    const story = tellDay(
      { pause: { by: "Dad", from: 20 * 60, to: 22 * 60 }, windows: [BEDTIME] },
      20 * 60 + 30,
      PHONE_VOICE,
    );
    expect(story.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Paused by Dad"],
      ["10 PM", "Bedtime"],
      ["7 AM", "Not blocked"],
    ]);
    expect(story.items[1]?.detail).toBe("Until 7 AM");
  });

  it("names the internet on Android, where FamilyFi blocks no apps", () => {
    expect(topAnswer(tellDay(paused, NOW, INTERNET_VOICE)).sentence).toBe("Dad paused your internet.");
  });

  it("ends a pause on a yes even when a window has started since", () => {
    const story = tellDay(
      {
        pause: { by: "Dad", from: 20 * 60, to: 22 * 60 },
        windows: [BEDTIME],
        ask: { state: "yes", at: 20 * 60, answeredAt: 20 * 60 + 5, by: "Dad" },
      },
      21 * 60 + 10,
      PHONE_VOICE,
    );
    expect(story.day.kind).toBe("window");
    expect(story.items[0]?.ask).toMatchObject({ withLength: true });
    expect(story.bands.find((band) => band.kind === "pause")).toMatchObject({
      from: 20 * 60,
      to: 20 * 60 + 5,
    });
  });

  it("tells a Thing waiting for an answer during a window", () => {
    const story = tellDay(
      {
        windows: [BEDTIME],
        ask: { state: "waiting", at: 21 * 60 + 5, minutes: 30 },
      },
      21 * 60 + 10,
      THING_VOICE,
    );
    expect(thingNote(story)).toBe("Bedtime until 7 AM. Waiting for an answer.");
    expect(thingTile(story)).toMatchObject({ word: "You asked" });
  });

  it("keeps a window's request and a pause's request apart", () => {
    const pauseInWindow: DaySubject = {
      pause: { by: "Dad", from: 21 * 60 + 20, to: 23 * 60 },
      windows: [BEDTIME],
      ask: {
        state: "yes",
        at: 21 * 60 + 5,
        answeredAt: 21 * 60 + 10,
        by: "Dad",
        minutes: 15,
      },
    };
    const paused = tellDay(pauseInWindow, 21 * 60 + 30, PHONE_VOICE);
    expect(paused.day.kind).toBe("paused");
    expect(paused.items[0]?.ask).toMatchObject({ withLength: true, label: "Ask to unpause" });

    const waitingToUnpause = tellDay(
      {
        pause: { by: "Dad", from: 20 * 60, to: 22 * 60 },
        windows: [BEDTIME],
        ask: { state: "waiting", at: 21 * 60 + 50 },
      },
      22 * 60 + 10,
      PHONE_VOICE,
    );
    expect(waitingToUnpause.day.kind).toBe("window");
    expect(waitingToUnpause.items[0]?.ask).toMatchObject({ withLength: true });
  });

  it("tells the not-blocked answers in each voice", () => {
    const open = tellDay({ windows: [] }, NOW, PHONE_VOICE);
    expect(topAnswer(open)).toMatchObject({ title: "Nothing is blocked", sentence: "Nothing is planned for today." });
    expect(thingTile(open)).toEqual({ word: "Not blocked", line: "For the rest of today", tone: "on" });
    expect(thingNote(open)).toBe("Not blocked today.");

    const yes = { state: "yes" as const, at: NOW, answeredAt: NOW + 5, by: "Dad" };
    const unpaused = tellDay({ ...paused, windows: [], ask: yes }, NOW + 10, THING_VOICE);
    expect(unpaused.day.kind).toBe("unpaused");
    expect(topAnswer(unpaused)).toMatchObject({ title: "Not blocked", sentence: "Dad unpaused it." });
    expect(thingTile(unpaused)).toEqual({ word: "Not blocked", line: "For the rest of today", tone: "on" });
    expect(unpaused.items[0]?.status?.text).toBe("Dad unblocked it at 3:50 PM.");
    expect(tellDay({ ...paused, ask: yes }, NOW + 10, INTERNET_VOICE).items[0]?.status?.text).toBe(
      "Dad unpaused your internet at 3:50 PM.",
    );

    const extended = tellDay(
      { windows: [BEDTIME], ask: { state: "yes", at: 21 * 60, answeredAt: 21 * 60 + 5, by: "Mom", minutes: 30 } },
      21 * 60 + 10,
      THING_VOICE,
    );
    expect(thingTile(extended)).toEqual({ word: "Allowed", line: "Until 9:35 PM", tone: "on" });
    expect(thingNote(extended)).toBe("Allowed until 9:35 PM.");
  });

  it("keeps an allowance inside the window it was answered in", () => {
    const homework = { label: "Homework time", from: 21 * 60, to: 22 * 60 };
    const subject: DaySubject = {
      windows: [homework, { label: "Bedtime", from: 22 * 60, to: 31 * 60 }],
      ask: { state: "yes", at: 21 * 60 + 50, answeredAt: 21 * 60 + 55, by: "Dad", minutes: 30 },
    };
    expect(topAnswer(tellDay(subject, 21 * 60 + 56, PHONE_VOICE)).title).toBe("Allowed until 10 PM");
    const bedtime = tellDay(subject, 22 * 60 + 5, PHONE_VOICE);
    expect(bedtime.day.kind).toBe("window");
    expect(topAnswer(bedtime).title).toBe("Bedtime until 7 AM");
    expect(bedtime.items[0]?.ask).toMatchObject({ withLength: true });
  });

  it("follows an overlapping window before saying nothing blocks", () => {
    const story = tellDay(
      {
        windows: [
          { label: "Homework time", from: 16 * 60, to: 18 * 60 },
          { label: "Evening", from: 17 * 60, to: 19 * 60 },
        ],
      },
      16 * 60 + 30,
      PHONE_VOICE,
    );
    expect(story.items.map((item) => [item.time, item.title, item.detail])).toEqual([
      ["Now", "Homework time", "4 PM until 6 PM"],
      ["6 PM", "Evening", "Until 7 PM"],
      ["7 PM", "Not blocked", "For the rest of today"],
    ]);
  });
});

describe("a child's day on the household's clock", () => {
  const ZONE = "America/New_York";
  // Monday 16 November 2026, 10:30 PM in New York (UTC-5).
  const MONDAY_NIGHT = new Date("2026-11-17T03:30:00Z");
  // Tuesday 17 November 2026, 6 AM in New York.
  const TUESDAY_MORNING = new Date("2026-11-17T11:00:00Z");
  const me = (patch: Partial<GroupDay> = {}): GroupDay => ({
    group: { id: "g1", name: "Emma" },
    timezone: ZONE,
    pause: null,
    allowance: null,
    windows: [],
    alwaysOn: [],
    ...patch,
  });
  const bedtime = (days: number[]) => ({ ruleId: "r1", ruleName: "Bedtime", name: "", days, start: "21:00", end: "07:00", allowed: null });

  it("counts minutes from the household's midnight, whatever the machine's zone", () => {
    const { clock: day, now } = householdDay(MONDAY_NIGHT, ZONE);
    expect(now).toBe(22 * 60 + 30);
    expect(day.midnight.toISOString()).toBe("2026-11-16T05:00:00.000Z");
    expect(day.timeZone).toBe(ZONE);
  });

  it("reads a window on the days it starts, including its morning tail", () => {
    const monday = meDaySubject(me({ windows: [bedtime([1])] }), MONDAY_NIGHT);
    expect(monday.subject.windows).toEqual([{ label: "Bedtime", from: 21 * 60, to: 31 * 60, days: [1] }]);
    expect(tellDay(monday.subject, monday.now, PHONE_VOICE, monday.clock).day.kind).toBe("window");
    const tuesday = meDaySubject(me({ windows: [bedtime([1])] }), TUESDAY_MORNING);
    expect(tuesday.now).toBe(6 * 60);
    expect(tellDay(tuesday.subject, tuesday.now, PHONE_VOICE, tuesday.clock).day.kind).toBe("window");
  });

  it("leaves a window alone on a day it does not start, and says it runs some days", () => {
    const { subject, now, clock: day } = meDaySubject(me({ windows: [bedtime([2])] }), MONDAY_NIGHT);
    const story = tellDay(subject, now, PHONE_VOICE, day);
    expect(story.day).toEqual({ kind: "open", next: undefined });
    // Its Tuesday occurrence starts on Tuesday, so Monday's bar has none of it.
    expect(story.bands).toEqual([]);
    const tuesday = meDaySubject(me({ windows: [bedtime([2])] }), TUESDAY_MORNING);
    const bands = tellDay(tuesday.subject, tuesday.now, PHONE_VOICE, tuesday.clock).bands;
    expect(bands.map((band) => band.source)).toEqual(["Tue"]);
  });

  it("draws a pause set before today from midnight, one with no end to the end of today, and tells no time it doesn't have", () => {
    const pause = { by: "Dad", since: "2026-11-16T22:00:00Z", until: null };
    const { subject, now, clock: day } = meDaySubject(me({ pause }), TUESDAY_MORNING);
    expect(subject.pause).toEqual({ by: "Dad", from: 0, to: 1440, open: true });
    const story = tellDay(subject, now, PHONE_VOICE, day);
    expect(story.day.kind).toBe("paused");
    // No end time is told: not "until 12 AM", and nothing later today.
    expect(topAnswer(story)).toMatchObject({ title: "Paused", sentence: "Dad paused your apps." });
    expect(story.items).toHaveLength(1);
    expect(story.items[0].detail).toBe("No end time");
    const band = story.bands.find((entry) => entry.kind === "pause")!;
    expect(bandTimes(band)).toBe("with no end time");
    expect(timelineLegend(story.bands)[0]?.times).toBe("with no end time");
    const thing = tellDay(subject, now, THING_VOICE, day);
    expect(thingTile(thing)).toMatchObject({ word: "Blocked", line: "No end time" });
    expect(thingNote(thing)).toBe("Blocked with no end time. Ask here and your parents decide.");
    // Set today with no end: no start either (FamilyFi knows when it was last set, not begun), never "until 12 AM".
    const today = meDaySubject(me({ pause: { by: "Dad", since: "2026-11-17T10:00:00Z", until: null } }), TUESDAY_MORNING);
    const told = tellDay(today.subject, today.now, PHONE_VOICE, today.clock);
    expect(told.items[0].detail).toBe("No end time");
    expect(bandTimes(told.bands.find((entry) => entry.kind === "pause")!)).toBe("with no end time");
    // With an end: only its end.
    const ending = meDaySubject(me({ pause: { by: "Dad", since: "2026-11-16T22:00:00Z", until: "2026-11-17T13:00:00Z" } }), TUESDAY_MORNING);
    const ends = tellDay(ending.subject, ending.now, PHONE_VOICE, ending.clock);
    expect(ends.items[0].detail).toBe("Until 8 AM");
    expect(bandTimes(ends.bands.find((entry) => entry.kind === "pause")!)).toBe("until 8 AM");
  });

  it("tells a window a parent lifted as allowed until then, and when it comes back", () => {
    // Bedtime 9 PM to 7 AM, Dad allowed it until 11 PM; it is 10:30 PM.
    const allowed = { ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T04:00:00Z" } };
    const { subject, now, clock: day } = meDaySubject(me({ windows: [allowed] }), MONDAY_NIGHT);
    expect(subject.windows[0].allowed).toEqual({ by: "Dad", until: 23 * 60 });
    const story = tellDay(subject, now, PHONE_VOICE, day);
    expect(story.day).toMatchObject({ kind: "extended", until: 23 * 60, by: "Dad" });
    expect(topAnswer(story)).toMatchObject({ title: "Allowed until 11 PM", sentence: "Dad said yes. Bedtime starts again at 11 PM." });
    expect(story.items.map((item) => item.title)).toEqual(["Allowed until 11 PM", "Bedtime again", "Not blocked"]);
    expect(story.bands.find((band) => band.kind === "allowance")).toMatchObject({ from: 21 * 60, to: 23 * 60, source: "Dad said yes" });
    // With no name: the window is off for now.
    const nameless = meDaySubject(me({ windows: [{ ...allowed, allowed: { by: null, until: "2026-11-17T04:00:00Z" } }] }), MONDAY_NIGHT);
    expect(topAnswer(tellDay(nameless.subject, nameless.now, PHONE_VOICE, nameless.clock)).sentence).toBe("Bedtime is off for now. Bedtime starts again at 11 PM.");
    // Before the window, a lift past its start moves when it starts.
    const evening = meDaySubject(me({ windows: [allowed] }), new Date("2026-11-17T00:00:00Z"));
    const early = tellDay(evening.subject, evening.now, PHONE_VOICE, evening.clock);
    expect(topAnswer(early).title).toBe("Nothing is blocked");
    expect(early.items.find((item) => item.sign === "window")?.time).toBe("11 PM");
    expect(topAnswer(early).sentence).toBe("Bedtime starts at 11 PM.");
    // Its band starts when the lift ends.
    expect(early.bands.filter((band) => band.kind === "window").map((band) => [band.from, band.to])).toEqual([[23 * 60, 1440]]);
  });

  it("tells a rule that blocks all internet all the time, never \"Nothing is blocked\"", () => {
    const blocked = me({ windows: [bedtime([1])], alwaysOn: [{ ruleId: "r2", name: "No internet", kind: "internet", allowed: null }, { ruleId: "r3", name: "Games", kind: "category", allowed: null }] });
    const { subject, now, clock: day } = meDaySubject(blocked, MONDAY_NIGHT);
    expect(subject.always).toEqual([{ label: "No internet" }]);
    const story = tellDay(subject, now, PHONE_VOICE, day);
    expect(story.day).toEqual({ kind: "always", label: "No internet" });
    expect(topAnswer(story)).toMatchObject({ title: "No internet", sentence: "No internet all day." });
    expect(story.items.map((item) => [item.title, item.detail])).toEqual([["No internet", "All day"]]);
    expect(story.bands).toEqual([{ kind: "window", from: 0, to: 1440, label: "No internet", source: "No internet", times: "All day" }]);
    expect(timelineLegend(story.bands)[0]?.times).toBe("All day");
    const thing = tellDay(subject, now, THING_VOICE, day);
    expect(thingTile(thing)).toEqual({ word: "No internet", line: "All day", tone: "window" });
    expect(thingNote(thing)).toBe("No internet all day.");
    const homework = meDaySubject(me({ alwaysOn: [{ ruleId: "r4", name: "Homework", kind: "internet", allowed: null }] }), MONDAY_NIGHT);
    expect(thingNote(tellDay(homework.subject, homework.now, THING_VOICE, homework.clock))).toBe("Homework: no internet all day.");
    // Lifted until 5 PM, read at 3 PM: allowed until then, and no internet from then on.
    const lifted = me({ alwaysOn: [{ ruleId: "r2", name: "No internet", kind: "internet", allowed: { by: "Dad", until: "2026-11-16T22:00:00Z" } }] });
    const afternoon = meDaySubject(lifted, new Date("2026-11-16T20:00:00Z"));
    const allowed = tellDay(afternoon.subject, afternoon.now, PHONE_VOICE, afternoon.clock);
    expect(topAnswer(allowed)).toMatchObject({ title: "Allowed until 5 PM", sentence: "Dad said yes. No internet starts again at 5 PM." });
    expect(allowed.items.map((item) => [item.time, item.title, item.detail])).toEqual([
      ["Now", "Allowed until 5 PM", "Dad said yes"],
      ["5 PM", "No internet again", "For the rest of today"],
    ]);
    // Read after 5 PM it blocks again.
    const evening = meDaySubject(lifted, new Date("2026-11-16T23:00:00Z"));
    expect(tellDay(evening.subject, evening.now, PHONE_VOICE, evening.clock).day.kind).toBe("always");
    // Lifted until 10 PM with Bedtime from 9 PM, read at 8 PM: allowed only until Bedtime.
    const grounded = me({ windows: [bedtime([1])], alwaysOn: [{ ruleId: "r2", name: "Grounded", kind: "internet", allowed: { by: "Dad", until: "2026-11-17T03:00:00Z" } }] });
    const eight = meDaySubject(grounded, new Date("2026-11-17T01:00:00Z"));
    const atEight = tellDay(eight.subject, eight.now, PHONE_VOICE, eight.clock);
    expect(topAnswer(atEight)).toMatchObject({ title: "Allowed until 9 PM", sentence: "Dad said yes. Bedtime starts at 9 PM." });
    expect(atEight.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Allowed until 9 PM"],
      ["9 PM", "Bedtime"],
    ]);
    // Inside Homework (4 to 6 PM) with the rule lifted until 5 PM: after Homework, the rule again, never "Not blocked".
    const study = { ruleId: "r1", ruleName: "Homework", name: "", days: [1], start: "16:00", end: "18:00", allowed: null };
    const inside = meDaySubject(me({ windows: [study], alwaysOn: [{ ruleId: "r2", name: "Grounded", kind: "internet", allowed: { by: "Dad", until: "2026-11-16T22:00:00Z" } }] }), new Date("2026-11-16T21:30:00Z"));
    const told = tellDay(inside.subject, inside.now, PHONE_VOICE, inside.clock);
    expect(told.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Homework"],
      ["6 PM", "Grounded again"],
    ]);
    // Grounded lifted until 5 PM, inside Homework (2 to 4 PM) lifted only until 3 PM: allowed until 3 PM, then Homework.
    const shortLift = { ...study, start: "14:00", end: "16:00", allowed: { by: "Mom", until: "2026-11-16T20:00:00Z" } };
    const both = meDaySubject(me({ windows: [shortLift], alwaysOn: [{ ruleId: "r2", name: "Grounded", kind: "internet", allowed: { by: "Dad", until: "2026-11-16T22:00:00Z" } }] }), new Date("2026-11-16T19:30:00Z"));
    const bothTold = tellDay(both.subject, both.now, PHONE_VOICE, both.clock);
    expect(topAnswer(bothTold).title).toBe("Allowed until 3 PM");
    expect(bothTold.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Allowed until 3 PM"],
      ["3 PM", "Homework"],
      ["4 PM", "Not blocked"],
      ["5 PM", "Grounded again"],
    ]);
    // A pause over a rule still on: after the pause, the rule, never "Not blocked".
    const paused = meDaySubject(me({ pause: { by: "Dad", since: "2026-11-16T20:00:00Z", until: "2026-11-16T21:00:00Z" }, alwaysOn: [{ ruleId: "r2", name: "Grounded", kind: "internet", allowed: null }] }), new Date("2026-11-16T20:30:00Z"));
    expect(tellDay(paused.subject, paused.now, PHONE_VOICE, paused.clock).items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Paused by Dad"],
      ["4 PM", "Grounded"],
    ]);
    // The same with Bedtime on when the pause ends: the rule, never "7 AM Not blocked".
    const overnight = meDaySubject(me({ windows: [bedtime([1])], pause: { by: "Dad", since: "2026-11-17T00:00:00Z", until: "2026-11-17T03:00:00Z" }, alwaysOn: [{ ruleId: "r2", name: "Grounded", kind: "internet", allowed: null }] }), new Date("2026-11-17T02:00:00Z"));
    expect(tellDay(overnight.subject, overnight.now, PHONE_VOICE, overnight.clock).items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Paused by Dad"],
      ["10 PM", "Grounded"],
    ]);
    // A category rule alone leaves the internet on.
    const games = meDaySubject(me({ alwaysOn: [{ ruleId: "r3", name: "Games", kind: "category", allowed: null }] }), MONDAY_NIGHT);
    expect(games.subject.always).toBeUndefined();
  });

  it("after a pause, skips a window lifted to its end and starts one lifted part way when the lift ends", () => {
    const pause = { by: "Dad", since: "2026-11-17T00:00:00Z", until: "2026-11-17T02:00:00Z" }; // 7 PM until 9 PM
    const all = meDaySubject(me({ pause, windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T14:00:00Z" } }] }), new Date("2026-11-17T01:00:00Z"));
    const skipped = tellDay(all.subject, all.now, PHONE_VOICE, all.clock);
    expect(skipped.items.map((item) => [item.time, item.title])).toEqual([["Now", "Paused by Dad"], ["9 PM", "Not blocked"]]);
    const part = meDaySubject(me({ pause, windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T03:00:00Z" } }] }), new Date("2026-11-17T01:00:00Z"));
    const resumed = tellDay(part.subject, part.now, PHONE_VOICE, part.clock);
    expect(resumed.items.map((item) => [item.time, item.title])).toEqual([["Now", "Paused by Dad"], ["9 PM", "Not blocked"], ["10 PM", "Bedtime"], ["7 AM", "Not blocked"]]);
  });

  it("after a pause, tells a window coming back after midnight when its lift ends then", () => {
    const pause = { by: "Dad", since: "2026-11-17T00:00:00Z", until: "2026-11-17T03:00:00Z" }; // until 10 PM
    const part = meDaySubject(me({ pause, windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T05:30:00Z" } }] }), new Date("2026-11-17T01:00:00Z"));
    const told = tellDay(part.subject, part.now, PHONE_VOICE, part.clock);
    expect(told.items.map((item) => [item.time, item.title, item.detail])).toEqual([
      ["Now", "Paused by Dad", "Until 10 PM"],
      ["10 PM", "Not blocked", "Until Bedtime"],
      ["12:30 AM", "Bedtime", "Until 7 AM"],
      ["7 AM", "Not blocked", "Tomorrow morning"],
    ]);
  });

  it("after a pause, tells a window that starts before a lifted one comes back", () => {
    const pause = { by: "Dad", since: "2026-11-17T00:00:00Z", until: "2026-11-17T03:00:00Z" }; // until 10 PM
    const late = { ruleId: "r2", ruleName: "Late", name: "", days: [1], start: "23:00", end: "00:00", allowed: null };
    const part = meDaySubject(me({ pause, windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T05:30:00Z" } }, late] }), new Date("2026-11-17T01:00:00Z"));
    const told = tellDay(part.subject, part.now, PHONE_VOICE, part.clock);
    expect(told.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Paused by Dad"],
      ["10 PM", "Not blocked"],
      ["11 PM", "Late"],
      ["12 AM", "Not blocked"],
      ["12:30 AM", "Bedtime"],
      ["7 AM", "Not blocked"],
    ]);
  });

  it("tells a window lifted past midnight from an open day, and ends an allowance where another window starts", () => {
    const lifted = { ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T05:30:00Z" } }; // until 12:30 AM
    const open = meDaySubject(me({ windows: [lifted] }), new Date("2026-11-17T00:00:00Z")); // 7 PM
    const evening = tellDay(open.subject, open.now, PHONE_VOICE, open.clock);
    expect(topAnswer(evening)).toMatchObject({ title: "Nothing is blocked", sentence: "Bedtime starts at 12:30 AM." });
    // Bedtime lifted until 11:30 PM, Late 11 PM to 12 AM; it is 9:30 PM.
    const late = { ruleId: "r2", ruleName: "Late", name: "", days: [1], start: "23:00", end: "00:00", allowed: null };
    const both = meDaySubject(me({ windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T04:30:00Z" } }, late] }), new Date("2026-11-17T02:30:00Z"));
    const story = tellDay(both.subject, both.now, PHONE_VOICE, both.clock);
    expect(topAnswer(story)).toMatchObject({ title: "Allowed until 11 PM", sentence: "Dad said yes. Late starts at 11 PM." });
    expect(story.items.map((item) => [item.time, item.title])).toEqual([
      ["Now", "Allowed until 11 PM"],
      ["11 PM", "Late"],
      ["12 AM", "Bedtime"],
      ["7 AM", "Not blocked"],
    ]);
  });

  it("tells the lifted window that comes back first, whichever rule came first", () => {
    // Homework 4 to 6 PM lifted until 5:30, Snack 4:30 to 5 PM lifted until 4:50; it is 4:45 PM.
    const homework = { ruleId: "r1", ruleName: "Homework", name: "", days: [1], start: "16:00", end: "18:00", allowed: { by: "Dad", until: "2026-11-16T22:30:00Z" } };
    const snack = { ruleId: "r2", ruleName: "Snack", name: "", days: [1], start: "16:30", end: "17:00", allowed: { by: "Dad", until: "2026-11-16T21:50:00Z" } };
    for (const windows of [[homework, snack], [snack, homework]]) {
      const told = meDaySubject(me({ windows }), new Date("2026-11-16T21:45:00Z"));
      const story = tellDay(told.subject, told.now, PHONE_VOICE, told.clock);
      expect(topAnswer(story).title).toBe("Allowed until 4:50 PM");
    }
  });

  it("ends an allowance past midnight where a window after midnight starts", () => {
    // Bedtime lifted until 2 AM, Early 1 to 3 AM; it is 11 PM.
    const early = { ruleId: "r2", ruleName: "Early", name: "", days: [2], start: "01:00", end: "03:00", allowed: null };
    const told = meDaySubject(me({ windows: [{ ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T07:00:00Z" } }, early] }), new Date("2026-11-17T04:00:00Z"));
    expect(topAnswer(tellDay(told.subject, told.now, PHONE_VOICE, told.clock)).title).toBe("Allowed until 1 AM");
  });

  it("tells nothing of a window a parent lifted for the whole of it", () => {
    // Bedtime lifted until 9 AM tomorrow; it is 7 PM.
    const lifted = { ...bedtime([1]), allowed: { by: "Dad", until: "2026-11-17T14:00:00Z" } };
    const { subject, now, clock: day } = meDaySubject(me({ windows: [lifted] }), new Date("2026-11-17T00:00:00Z"));
    const story = tellDay(subject, now, PHONE_VOICE, day);
    expect(topAnswer(story)).toMatchObject({ title: "Nothing is blocked", sentence: "Nothing is planned for today." });
    expect(thingTile(tellDay(subject, now, THING_VOICE, day))).toMatchObject({ line: "For the rest of today" });
    expect(story.items.some((item) => item.sign === "window")).toBe(false);
    expect(story.bands.filter((band) => band.kind === "window")).toEqual([]);
  });

  it("reads FamilyFi's ask on the household's clock, naming a parent it has no name for", () => {
    const at = "2026-11-17T03:10:00Z";
    const answered = "2026-11-17T03:20:00Z";
    const again = "2026-11-17T03:50:00Z";
    const ask = { id: "a1", about: "rule" as const, ruleId: "r1", minutes: 30, state: "no" as const, at, answeredAt: answered, by: null, askAgainAt: again };
    const { subject } = meDaySubject(me({ windows: [bedtime([1])], ask }), MONDAY_NIGHT);
    expect(subject.ask).toEqual({ state: "no", at: 22 * 60 + 10, answeredAt: 22 * 60 + 20, minutes: 30, againAt: 22 * 60 + 50 });
    const waiting = meDaySubject(me({ ask: { id: "a2", about: "pause", state: "waiting", at, expiresAt: again, by: null } }), MONDAY_NIGHT);
    expect(waiting.subject.ask).toEqual({ state: "waiting", at: 22 * 60 + 10 });
    const group = { id: "g1", name: "Emma", suspension: { active: false, until: null, by: null }, allowance: { active: false, until: null, by: null } };
    expect(groupDayOf({ ...group, ask: { ...ask, by: { accountId: "mom", name: "Mom" } } }, [], ZONE, MONDAY_NIGHT).ask?.by).toBe("Mom");
    expect(groupDayOf(group, [], ZONE, MONDAY_NIGHT).ask).toBeNull();
    // An ask sent at 10:09:36 PM was sent at 10:09, as the phone's clock said then, never 10:10.
    const early = meDaySubject(me({ ask: { id: "a3", about: "pause", state: "waiting", at: "2026-11-17T03:09:36Z", expiresAt: again, by: null } }), MONDAY_NIGHT);
    expect(early.subject.ask).toEqual({ state: "waiting", at: 22 * 60 + 9 });
  });

  it("tells a Thing its Block button rule blocks as blocked, so the child can ask to unblock it", () => {
    const video = {
      id: "r3",
      name: "Video",
      kind: "category",
      scope: "group",
      groupIds: ["t1"],
      enabled: true,
      builtIn: null,
      mode: "always",
      windows: [],
      targetIds: [],
      pause: { active: false, until: null, kind: "pause", by: null },
      groupPauses: [],
    } as unknown as Rule;
    const tv = { id: "t1", name: "TV", kind: "things" as const, blockButtonRuleId: "r3", suspension: { active: false, until: null, by: null }, allowance: { active: false, until: null, by: null } };
    const day = groupDayOf(tv, [video], ZONE, MONDAY_NIGHT);
    expect(day.pause).toEqual({ by: null, until: null });
    const { subject, now, clock: on } = meDaySubject(day, MONDAY_NIGHT);
    const story = tellDay(subject, now, THING_VOICE, on);
    expect(topAnswer(story)).toMatchObject({ title: "Blocked", sentence: "It is blocked." });
    expect(story.items[0]?.ask?.label).toBe("Ask to unblock");
    // Unblocked for TV, or not its Block button rule: nothing to tell.
    const lifted = { ...video, groupPauses: [{ groupId: "t1", pause: { active: true, until: "2026-11-17T05:00:00Z", kind: "allow", by: null } }] } as unknown as Rule;
    expect(groupDayOf(tv, [lifted], ZONE, MONDAY_NIGHT).pause).toBeNull();
    expect(groupDayOf({ ...tv, blockButtonRuleId: undefined }, [video], ZONE, MONDAY_NIGHT).pause).toBeNull();
    // A child's own phone is told only its pause.
    expect(groupDayOf({ ...tv, kind: "family" as const }, [video], ZONE, MONDAY_NIGHT).pause).toBeNull();
  });

  it("asks to unblock a Thing for a length, and tells a yes for it until it ends", () => {
    const video = {
      id: "r3",
      name: "Video",
      kind: "category",
      scope: "group",
      groupIds: ["t1"],
      enabled: true,
      builtIn: null,
      mode: "always",
      windows: [],
      targetIds: [],
      pause: { active: false, until: null, kind: "pause", by: null },
      groupPauses: [],
    } as unknown as Rule;
    const tv = { id: "t1", name: "TV", kind: "things" as const, blockButtonRuleId: "r3", suspension: { active: false, until: null, by: null }, allowance: { active: false, until: null, by: null } };
    // Asked for 2 hours at 10:25 PM: the ask shows its length while it waits.
    const asked = { ...tv, ask: { id: "a1", about: "pause" as const, minutes: 120, state: "waiting" as const, at: "2026-11-17T03:25:00Z", expiresAt: "2026-11-17T04:25:00Z" } };
    const waiting = meDaySubject(groupDayOf(asked, [video], ZONE, MONDAY_NIGHT), MONDAY_NIGHT);
    const told = tellDay(waiting.subject, waiting.now, THING_VOICE, waiting.clock);
    expect(told.items[0]?.status?.text).toBe("You asked for 2 hours at 10:25 PM. Waiting for an answer.");
    // A yes: Video paused for TV until 11:30 PM. Allowed until then, then blocked again, as the Thing says it.
    const yes = { ...asked.ask, state: "yes" as const, answeredAt: "2026-11-17T03:30:00Z", by: { name: "Nick" } };
    const lifted = { ...video, groupPauses: [{ groupId: "t1", pause: { active: true, until: "2026-11-17T04:30:00Z", kind: "pause", by: { name: "Nick" } } }] } as unknown as Rule;
    const day = meDaySubject(groupDayOf({ ...tv, ask: yes } as never, [lifted], ZONE, MONDAY_NIGHT), MONDAY_NIGHT);
    const story = tellDay(day.subject, day.now, THING_VOICE, day.clock);
    expect(story.items[0]).toMatchObject({ title: "Allowed until 11:30 PM", detail: "Nick said yes" });
    expect(story.items[1]).toMatchObject({ time: "11:30 PM", title: "Blocked again", detail: "For the rest of today" });
    expect(topAnswer(story).sentence).toBe("Nick said yes. Blocked again at 11:30 PM.");
    expect(thingTile(story)).toEqual({ word: "Allowed", line: "Until 11:30 PM", tone: "on" });
  });

  it("tells a break in a pause ending today around the windows of the day, in the voice's words", () => {
    const tell = (subject: unknown, voice = PHONE_VOICE) => tellDay(subject as never, 19 * 60, voice).items.map((item) => [item.time, item.title, item.detail]);
    // A break until 9 PM in a pause until 10 PM, on a family member's phone.
    const pauseBreak = { label: "Paused", pause: true, allowed: { by: "Nick", until: 21 * 60 }, to: 22 * 60 };
    // A window during the break: told, then the break's rest, then the pause again until its end.
    expect(tell({ windows: [{ label: "Homework", from: 20 * 60, to: 20 * 60 + 30 }], always: [pauseBreak] })).toEqual([
      ["Now", "Allowed until 8 PM", "Nick said yes"],
      ["8 PM", "Homework", "Until 8:30 PM"],
      ["8:30 PM", "Not blocked", "Until 9 PM"],
      ["9 PM", "Paused again", "Until 10 PM"],
      ["10 PM", "Not blocked", "For the rest of today"],
    ]);
    // A window already on when the pause ends carries on.
    expect(tell({ windows: [{ label: "Bedtime", from: 21 * 60 + 30, to: 23 * 60 }], always: [pauseBreak] })).toEqual([
      ["Now", "Allowed until 9 PM", "Nick said yes"],
      ["9 PM", "Paused again", "Until 10 PM"],
      ["10 PM", "Bedtime", "Until 11 PM"],
      ["11 PM", "Not blocked", "For the rest of today"],
    ]);
    // The pause comes back in the paused ink on the timeline, as the list's row does.
    expect(tellDay({ windows: [], always: [pauseBreak] } as never, 19 * 60, PHONE_VOICE).bands).toContainEqual(expect.objectContaining({ kind: "pause", from: 21 * 60, to: 22 * 60 }));
    // A Thing's pause with no end, answered by no one named.
    const story = tellDay({ windows: [], always: [{ label: "Paused", pause: true, open: true, allowed: { until: 21 * 60 } }] } as never, 19 * 60, THING_VOICE);
    expect(story.items.map((item) => [item.time, item.title, item.detail])).toEqual([
      ["Now", "Allowed until 9 PM", "It is unblocked"],
      ["9 PM", "Blocked again", "No end time"],
    ]);
  });

  it("tells a pause's break as allowed until it ends, then blocked again", () => {
    const computers = {
      id: "t2",
      name: "Computers",
      kind: "things" as const,
      // Blocked until 12:39 AM, with a break until 11 PM from a yes to a 30 minute ask.
      suspension: { active: false, until: "2026-11-17T05:39:00Z", by: { name: "Nick" }, resumesAt: "2026-11-17T04:00:00Z" },
      allowance: { active: true, until: "2026-11-17T04:00:00Z", by: { name: "Nick" } },
    };
    const day = groupDayOf(computers as never, [], ZONE, MONDAY_NIGHT);
    expect(day.pause).toBeNull();
    expect(day.pauseBreak).toEqual({ by: "Nick", until: "2026-11-17T04:00:00Z", pauseUntil: "2026-11-17T05:39:00Z" });
    const { subject, now, clock: on } = meDaySubject(day, MONDAY_NIGHT);
    const story = tellDay(subject, now, THING_VOICE, on);
    expect(story.items[0]).toMatchObject({ title: "Allowed until 11 PM", detail: "Nick said yes" });
    expect(story.items[1]).toMatchObject({ time: "11 PM", title: "Blocked again" });
    // A pause ending today: blocked again until its end, then not blocked.
    const ending = { ...computers, suspension: { ...computers.suspension, until: "2026-11-17T04:30:00Z" } };
    const short = meDaySubject(groupDayOf(ending as never, [], ZONE, MONDAY_NIGHT), MONDAY_NIGHT);
    const told = tellDay(short.subject, short.now, THING_VOICE, short.clock);
    expect(told.items[1]).toMatchObject({ time: "11 PM", title: "Blocked again", detail: "Until 11:30 PM" });
    expect(told.items[2]).toMatchObject({ time: "11:30 PM" });
    expect(told.items[2]?.title).not.toContain("again");
    // A break past midnight is still a break, never the pause ended: allowed until then, nothing more today.
    const late = { ...computers, ask: { id: "a1", about: "pause" as const, minutes: 120, state: "yes" as const, at: "2026-11-17T03:25:00Z", answeredAt: "2026-11-17T03:30:00Z", expiresAt: "2026-11-17T04:25:00Z", by: { name: "Nick" } }, suspension: { ...computers.suspension, until: "2026-11-17T12:00:00Z", resumesAt: "2026-11-17T06:00:00Z" }, allowance: { ...computers.allowance, until: "2026-11-17T06:00:00Z" } };
    for (const voice of [PHONE_VOICE, THING_VOICE]) {
      const night = meDaySubject(groupDayOf(late as never, [], ZONE, MONDAY_NIGHT), MONDAY_NIGHT);
      const after = tellDay(night.subject, night.now, voice, night.clock);
      expect(after.items).toEqual([expect.objectContaining({ title: "Allowed until 1 AM", detail: "Nick said yes" })]);
      expect(topAnswer(after).sentence).toBe(`Nick said yes. ${voice.pauseWord} again at 1 AM.`);
    }
    // Once the break is over, the pause is told again (FamilyFi reports it active).
    expect(groupDayOf({ ...computers, suspension: { ...computers.suspension, resumesAt: "2026-11-17T03:00:00Z" } } as never, [], ZONE, MONDAY_NIGHT).pauseBreak).toBeUndefined();
  });

  it("tells a yes as the group's pause and lifts stand now, not as it was asked", () => {
    const at = "2026-11-17T03:00:00Z"; // 10 PM
    const answeredAt = "2026-11-17T03:05:00Z";
    const yes = { id: "a1", about: "rule" as const, ruleId: "r1", minutes: 60, state: "yes" as const, at, answeredAt, by: "Mom" };
    // Asked for an hour, given until 10:15 PM: at 10:20 PM Bedtime blocks again.
    const over = meDaySubject(me({ windows: [bedtime([1])], ask: yes }), new Date("2026-11-17T03:20:00Z"));
    expect(over.subject.ask).toBeUndefined();
    expect(tellDay(over.subject, over.now, PHONE_VOICE, over.clock).day.kind).toBe("window");
    // While it runs, it is told for the time given.
    const lifted = { ...bedtime([1]), allowed: { by: "Mom", until: "2026-11-17T03:15:00Z" } };
    const during = meDaySubject(me({ windows: [lifted], ask: yes }), new Date("2026-11-17T03:10:00Z"));
    const story = tellDay(during.subject, during.now, PHONE_VOICE, during.clock);
    expect(story.items[0]).toMatchObject({ title: "Allowed until 10:15 PM", detail: "Mom said yes to 10 more minutes" });
    // Unpaused on a yes, then paused again: the new pause is what is told.
    const pauseYes = { id: "a2", about: "pause" as const, state: "yes" as const, at, answeredAt, by: "Mom" };
    const again = meDaySubject(me({ pause: { by: "Dad", since: "2026-11-17T03:10:00Z", until: null }, ask: pauseYes }), new Date("2026-11-17T03:20:00Z"));
    expect(again.subject.ask).toBeUndefined();
    expect(tellDay(again.subject, again.now, PHONE_VOICE, again.clock).day.kind).toBe("paused");
    expect(meDaySubject(me({ ask: pauseYes }), new Date("2026-11-17T03:20:00Z")).subject.ask).toMatchObject({ state: "yes", by: "Mom" });
    // FamilyFi reports no pause once a parent ends it: the yes alone tells who unpaused.
    const unpaused = meDaySubject(me({ ask: pauseYes }), new Date("2026-11-17T03:20:00Z"));
    const told = tellDay(unpaused.subject, unpaused.now, PHONE_VOICE, unpaused.clock);
    expect(told.day.kind).toBe("unpaused");
    expect(told.items[0]?.status?.text).toBe("Mom unpaused your apps at 10:05 PM.");
    expect(topAnswer(told).sentence).toMatch(/^Mom unpaused your apps\./);
    // A shared Thing tells the same yes in its own voice.
    const thing = tellDay(unpaused.subject, unpaused.now, THING_VOICE, unpaused.clock);
    expect(thing.items[0]?.status?.text).toBe("Mom unblocked it at 10:05 PM.");
    expect(thingTile(thing).tone).toBe("on");
    // It is told for the rest of that day only: the next morning, and the next evening, are ordinary days.
    for (const later of ["2026-11-17T13:00:00Z", "2026-11-18T02:00:00Z"]) {
      const next = meDaySubject(me({ ask: pauseYes }), new Date(later));
      expect(next.subject.ask).toBeUndefined();
      expect(tellDay(next.subject, next.now, PHONE_VOICE, next.clock).day.kind).toBe("open");
    }
  });

  it("names no one for a parent FamilyFi has no name for, and drops a timed-out ask once its block is over", () => {
    const at = "2026-11-17T03:10:00Z";
    const no = { id: "a1", about: "rule" as const, ruleId: "r1", minutes: 30, state: "no" as const, at, answeredAt: at, by: null, askAgainAt: "2026-11-17T04:00:00Z" };
    const declined = meDaySubject(me({ windows: [bedtime([1])], ask: no }), MONDAY_NIGHT);
    const story = tellDay(declined.subject, declined.now, PHONE_VOICE, declined.clock);
    expect(story.items[0]?.status?.text).toBe("Not this time. You can ask again at 11 PM.");
    const lapsed = { id: "a2", about: "rule" as const, ruleId: "r1", minutes: 30, state: "timedOut" as const, at, by: null };
    // Bedtime is still on: the child is told no one answered.
    expect(meDaySubject(me({ windows: [bedtime([1])], ask: lapsed }), MONDAY_NIGHT).subject.ask).toEqual({ state: "timedOut", at: 22 * 60 + 10, minutes: 30 });
    // Asked about another rule, or about a pause that has ended: nothing to tell.
    expect(meDaySubject(me({ windows: [bedtime([1])], ask: { ...lapsed, ruleId: "r2" } }), MONDAY_NIGHT).subject.ask).toBeUndefined();
    expect(meDaySubject(me({ ask: { ...lapsed, about: "pause" as const, ruleId: undefined } }), MONDAY_NIGHT).subject.ask).toBeUndefined();
  });

  it("tells nothing for an ask whose state or subject a newer server added", () => {
    const at = "2026-11-17T03:10:00Z";
    const waiting = { id: "a1", about: "rule", ruleId: "r1", minutes: 30, state: "waiting", at, by: null };
    expect(meDaySubject(me({ windows: [bedtime([1])], ask: waiting }), MONDAY_NIGHT).subject.ask).toMatchObject({ state: "waiting" });
    expect(meDaySubject(me({ windows: [bedtime([1])], ask: { ...waiting, state: "withdrawn" } }), MONDAY_NIGHT).subject.ask).toBeUndefined();
    expect(meDaySubject(me({ windows: [bedtime([1])], ask: { ...waiting, about: "app" } }), MONDAY_NIGHT).subject.ask).toBeUndefined();
  });

  it("names a window by its own name, or else its rule's, and says a pause without a name when FamilyFi did not record who", () => {
    const named = { ...bedtime([1]), name: "School night" };
    const { subject } = meDaySubject(me({ windows: [named], pause: { by: null, since: "2026-11-17T03:00:00Z", until: "2026-11-17T04:00:00Z" } }), MONDAY_NIGHT);
    expect(subject.windows[0].label).toBe("School night");
    expect(subject.pause).toEqual({ from: 22 * 60, to: 23 * 60 });
    const story = tellDay(subject, 22 * 60 + 30, PHONE_VOICE, householdDay(MONDAY_NIGHT, ZONE).clock);
    expect(story.items[0].title).toBe("Paused");
    expect(story.bands.find((band) => band.kind === "pause")?.source).toBe("Paused");
    expect(topAnswer(story).sentence).toBe("Your apps are paused.");
  });
});

describe("a length of the child's own", () => {
  it("offers every quarter hour up to four hours, worded as the parent reads it", () => {
    const choices = askLengthChoices();
    expect(choices[0]).toEqual({ value: 15, label: "15 minutes" });
    expect(choices.find((choice) => choice.value === 90)?.label).toBe("1 hour 30 minutes");
    expect(choices.at(-1)).toEqual({ value: 240, label: "4 hours" });
    expect(choices.every((choice) => choice.value % ASK_LENGTH_STEP === 0 && askLengthAllowed(choice.value))).toBe(true);
  });

  it("takes only what FamilyFi takes, and says so plainly otherwise", () => {
    expect(askLengthAllowed(ASK_MINUTES.min)).toBe(true);
    expect(askLengthAllowed(ASK_MINUTES.max)).toBe(true);
    expect(askLengthAllowed(4)).toBe(false);
    expect(askLengthAllowed(241)).toBe(false);
    expect(askLengthAllowed(30.5)).toBe(false);
    expect(ASK_LENGTH_REFUSAL).toBe("You can ask for 5 minutes to 4 hours.");
  });

  it("words the switch short enough for three parts on one line, and says the rest in full", () => {
    expect(ASK_LENGTHS.map((length) => length.short)).toEqual(["30m", "1h"]);
    expect(askLengthChoices().map((choice) => askLengthShort(choice.value))).toContain("1h 45m");
    expect(askLengthShort(15)).toBe("15m");
    expect(askLengthShort(240)).toBe("4h");
    expect(Math.max(...askLengthChoices().map((choice) => askLengthShort(choice.value).length))).toBeLessThanOrEqual(6);
    expect(ASK_OTHER_LENGTH).toBe("Other…");
    expect(ASK_LENGTH_TITLE).toBe("How long");
    expect(askLengthChosenLabel(105)).toBe("Change length, 1 hour 45 minutes chosen");
  });

  it("keeps the limits the HTTP contract states", () => {
    type Spec = { paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: { oneOf: { properties: { minutes?: { minimum: number; maximum: number } } }[] } } } } } }> };
    const spec = YAML.parse(readFileSync(path.resolve(__dirname, "../../openapi/familyfi.v1.yaml"), "utf8")) as Spec;
    const bodies = spec.paths["/api/v1/groups/{id}/asks"].post.requestBody.content["application/json"].schema.oneOf;
    // Both asks take a length: a window's always, an ask to unblock when the child chose one.
    const minutes = bodies.map((body) => body.properties.minutes);
    expect(minutes).toHaveLength(2);
    for (const length of minutes) expect(length).toMatchObject({ type: "integer", minimum: ASK_MINUTES.min, maximum: ASK_MINUTES.max });
  });
});
