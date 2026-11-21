import { describe, expect, it } from "vitest";

import type { GroupDay } from "@/lib/child-day";
import { headsUpBlocks, headsUpNotices, headsUpTimeline } from "@/lib/heads-up";

const ZONE = "America/New_York";
// Monday 16 November 2026, 8 PM in New York (UTC-5).
const MONDAY_EVENING = new Date("2026-11-17T01:00:00Z");
const at = (iso: string) => new Date(iso).toISOString();

const me = (patch: Partial<GroupDay> = {}): GroupDay => ({
  group: { id: "g1", name: "Emma" },
  timezone: ZONE,
  pause: null,
  allowance: null,
  windows: [],
  alwaysOn: [],
  ...patch,
});
const bedtime = (allowed: { by: string | null; until: string } | null = null) => ({
  ruleId: "r1",
  ruleName: "Nights",
  name: "Bedtime",
  days: [0, 1, 2, 3, 4, 5, 6],
  start: "21:00",
  end: "07:00",
  allowed,
});

describe("the heads-up before a block starts or ends", () => {
  it("plans each night's bedtime on the household's clock", () => {
    const blocks = headsUpBlocks(me({ windows: [bedtime()] }), MONDAY_EVENING, 2);
    expect(blocks.map((block) => [block.name, at(block.from.toISOString()), block.to?.toISOString()])).toEqual([
      ["Bedtime", "2026-11-17T02:00:00.000Z", "2026-11-17T12:00:00.000Z"],
      ["Bedtime", "2026-11-18T02:00:00.000Z", "2026-11-18T12:00:00.000Z"],
    ]);
  });

  it("says five minutes ahead when bedtime starts and when it ends, in the household's time", () => {
    const blocks = headsUpBlocks(me({ windows: [bedtime()] }), MONDAY_EVENING, 1);
    const notices = headsUpNotices(blocks, MONDAY_EVENING, ZONE, "apps");
    expect(notices.map(({ at, kind, title, body }) => ({ at: at.toISOString(), kind, title, body }))).toEqual([
      {
        at: "2026-11-17T01:55:00.000Z",
        kind: "start",
        title: "Bedtime starts in 5 minutes",
        body: "Save your game and finish your messages. Your apps pause at 9 PM.",
      },
      { at: "2026-11-17T11:55:00.000Z", kind: "end", title: "Bedtime ends in 5 minutes", body: "Your apps are back at 7 AM." },
    ]);
  });

  it("speaks of the internet when the phone's apps are not covered", () => {
    const notices = headsUpNotices(headsUpBlocks(me({ windows: [bedtime()] }), MONDAY_EVENING, 1), MONDAY_EVENING, ZONE, "internet");
    expect(notices.map((notice) => notice.body)).toEqual([
      "Save your game and finish your messages. Your internet pauses at 9 PM.",
      "Your internet is back at 7 AM.",
    ]);
  });

  it("tells the end of extra time a parent gave, not the window's own start", () => {
    // Bedtime started at 9 PM; a parent said yes to 30 more minutes at 9:00, so it is back at 9:30.
    const now = new Date("2026-11-17T02:10:00Z");
    const blocks = headsUpBlocks(me({ windows: [bedtime({ by: "Nick", until: "2026-11-17T02:30:00Z" })] }), now, 1);
    expect(blocks[0]).toMatchObject({ name: "Bedtime", afterExtraTime: true });
    expect(blocks[0]!.from.toISOString()).toBe("2026-11-17T02:30:00.000Z");
    const [first] = headsUpNotices(blocks, now, ZONE, "apps");
    expect(first).toMatchObject({ kind: "start", title: "Your extra time ends in 5 minutes", body: "Bedtime is back on. Your apps pause at 9:30 PM." });
  });

  it("gives nothing for a start already passed, and only the end of a pause", () => {
    const blocks = headsUpBlocks(me({ pause: { by: "Nick", until: "2026-11-17T01:30:00Z" } }), MONDAY_EVENING, 1);
    const notices = headsUpNotices(blocks, MONDAY_EVENING, ZONE, "apps");
    expect(notices.map(({ kind, title }) => [kind, title])).toEqual([["end", "Your pause ends in 5 minutes"]]);
  });

  it("gives no notice for a change less than five minutes away", () => {
    const now = new Date("2026-11-17T01:57:00Z");
    const notices = headsUpNotices(headsUpBlocks(me({ windows: [bedtime()] }), now, 1), now, ZONE, "apps");
    expect(notices.map((notice) => notice.kind)).toEqual(["end"]);
  });

  it("joins a pause that runs into bedtime into one block named for the pause", () => {
    const blocks = headsUpBlocks(me({ pause: { by: "Nick", until: "2026-11-17T02:30:00Z" }, windows: [bedtime()] }), MONDAY_EVENING, 1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ name: "Pause", pause: true });
    expect(blocks[0]!.to?.toISOString()).toBe("2026-11-17T12:00:00.000Z");
  });

  it("gives the widget what comes next, then what is under way, then open", () => {
    const blocks = headsUpBlocks(me({ windows: [bedtime()] }), MONDAY_EVENING, 1);
    expect(headsUpTimeline(blocks, MONDAY_EVENING, ZONE).map(({ from, blocked, title, line, until }) => [from.toISOString(), blocked, title, line, until?.toISOString() ?? null])).toEqual([
      ["2026-11-17T01:00:00.000Z", false, "Bedtime", "Starts at 9 PM", "2026-11-17T02:00:00.000Z"],
      ["2026-11-17T02:00:00.000Z", true, "Bedtime", "Ends at 7 AM", "2026-11-17T12:00:00.000Z"],
      ["2026-11-17T12:00:00.000Z", false, "Open", "Nothing planned", null],
    ]);
  });

  it("stops the widget at a block with no end", () => {
    const blocks = headsUpBlocks(me({ pause: { by: "Nick", until: null }, windows: [bedtime()] }), MONDAY_EVENING, 1);
    expect(headsUpTimeline(blocks, MONDAY_EVENING, ZONE).map(({ blocked, title, line }) => [blocked, title, line])).toEqual([[true, "Pause", "Until a parent ends it"]]);
    expect(headsUpNotices(blocks, MONDAY_EVENING, ZONE, "apps")).toEqual([]);
  });
});
