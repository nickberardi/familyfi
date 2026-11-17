import { describe, expect, it } from "vitest";
import { bandTimes, timelineLegend } from "@/lib/day-timeline";

import {
  INTERNET_VOICE,
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

  it("asks to unpause during a pause, with no length", () => {
    const story = tellDay(paused, NOW, PHONE_VOICE);
    expect(story.day.kind).toBe("paused");
    expect(story.items[0]).toMatchObject({
      now: true,
      title: "Paused by Dad",
      ask: { withLength: false, label: "Ask to unpause" },
    });
    expect(topAnswer(story)).toMatchObject({
      title: "Paused until 5 PM",
      sentence: "Dad paused your apps.",
    });
  });

  // familyfi's unblock ends a pause (docs/group-states.md): a yes is never "30 minutes, then paused again".
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
      ask: { withLength: false, label: "Ask to unpause" },
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
    expect(paused.items[0]?.ask).toMatchObject({ withLength: false });

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
