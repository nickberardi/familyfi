import { describe, expect, it } from "vitest";

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
  type MeDay,
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
    expect(thingTile(open)).toEqual({ word: "Not blocked", line: "All day", tone: "on" });
    expect(thingNote(open)).toBe("Not blocked today.");

    const yes = { state: "yes" as const, at: NOW, answeredAt: NOW + 5, by: "Dad" };
    const unpaused = tellDay({ ...paused, windows: [], ask: yes }, NOW + 10, THING_VOICE);
    expect(unpaused.day.kind).toBe("unpaused");
    expect(topAnswer(unpaused)).toMatchObject({ title: "Not blocked", sentence: "Dad unpaused it." });
    expect(thingTile(unpaused)).toEqual({ word: "Not blocked", line: "All day", tone: "on" });
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
  const me = (patch: Partial<MeDay> = {}): MeDay => ({
    group: { id: "g1", name: "Emma" },
    timezone: ZONE,
    pause: null,
    allowance: null,
    windows: [],
    alwaysOn: [],
    ...patch,
  });
  const bedtime = (days: number[]) => ({ ruleId: "r1", ruleName: "Bedtime", name: "", days, start: "21:00", end: "07:00" });

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
    expect(bands.map((band) => band.source)).toEqual(["Some days"]);
  });

  it("draws a pause from yesterday from where it began, and one with no end to the end of today", () => {
    const pause = { by: "Dad", since: "2026-11-16T22:00:00Z", until: null };
    const { subject, now, clock: day } = meDaySubject(me({ pause }), TUESDAY_MORNING);
    expect(subject.pause).toEqual({ by: "Dad", from: -7 * 60, to: 1440 });
    expect(tellDay(subject, now, PHONE_VOICE, day).day.kind).toBe("paused");
  });

  it("names a window by its own name, or else its rule's, and a pause by someone when FamilyFi did not record who", () => {
    const named = { ...bedtime([1]), name: "School night" };
    const { subject } = meDaySubject(me({ windows: [named], pause: { by: null, since: "2026-11-17T03:00:00Z", until: "2026-11-17T04:00:00Z" } }), MONDAY_NIGHT);
    expect(subject.windows[0].label).toBe("School night");
    expect(subject.pause).toEqual({ by: "A parent", from: 22 * 60, to: 23 * 60 });
  });
});
