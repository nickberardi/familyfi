import { describe, expect, it } from "vitest";
import { groupMonogram, internetMarkLook, internetZoneText, personMonogram } from "@/lib/internet-zone";
import { formatClock } from "@/lib/display";
import type { InternetWindow } from "@/lib/rule-windows";

const TZ = "America/New_York";
// Monday 28 September 2026 is EDT, UTC−4.
const at = (local: string) => new Date(`${local}-04:00`);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const bedtime: InternetWindow = { name: "", days: EVERY_DAY, start: "22:00", end: "06:00", ruleName: "Bedtime" };

const group = (patch: Partial<Parameters<typeof internetZoneText>[0]> = {}) => ({
  name: "A child group",
  deviceCount: 2,
  suspension: { active: false, until: null, by: null },
  allowance: { active: false, until: null, by: null },
  ...patch,
});
const clock = (local: string) => formatClock(at(local), TZ);

describe("internet zone", () => {
  it("says a group with no internet rule has nothing limiting it", () => {
    expect(internetZoneText(group(), [], TZ, at("2026-09-28T12:00:00"))).toEqual({
      tone: "no_rule",
      title: "All internet · no rule",
      sub: "Nothing limits A child group’s internet. Category rules still apply on their own.",
    });
  });

  it("names the next window while online, and the window and its end while off", () => {
    const online = internetZoneText(group(), [bedtime], TZ, at("2026-09-28T12:00:00"));
    expect(online).toMatchObject({ tone: "on", title: "All internet · on" });
    expect(online.sub).toBe(`Bedtime starts at ${clock("2026-09-28T22:00:00")}, on all 2 of its devices.`);

    const off = internetZoneText(group({ deviceCount: 1 }), [bedtime], TZ, at("2026-09-28T23:00:00"));
    expect(off).toMatchObject({ tone: "off", title: "All internet · off" });
    expect(off.sub).toBe(`Bedtime until ${clock("2026-09-29T06:00:00")}, on its 1 device.`);
  });

  it("names who paused and until when, or until resumed", () => {
    const until = at("2026-09-28T13:00:00").toISOString();
    const by = { accountId: "a1", name: "An adult" };
    const paused = internetZoneText(group({ suspension: { active: true, until, by } }), [bedtime], TZ, at("2026-09-28T12:00:00"));
    expect(paused).toMatchObject({ tone: "paused", title: "All internet · off" });
    expect(paused.sub).toBe(`Paused until ${clock("2026-09-28T13:00:00")} by An adult, on all 2 of its devices.`);

    const open = internetZoneText(group({ suspension: { active: true, until: null, by: null } }), [], TZ, at("2026-09-28T12:00:00"));
    expect(open.sub).toBe("Paused until you resume, on all 2 of its devices.");
  });

  it("says which window an allowance lifts", () => {
    const allowed = internetZoneText(group({ allowance: { active: true, until: null, by: null } }), [bedtime], TZ, at("2026-09-28T23:00:00"));
    expect(allowed).toMatchObject({ tone: "on", sub: "Bedtime lifted, on all 2 of its devices." });
  });

  it("marks a closed card's internet as Paused, Off, On or No rule, in token names", () => {
    const noon = at("2026-09-28T12:00:00");
    expect(internetMarkLook(group({ suspension: { active: true, until: null, by: null } }), [], TZ, noon)).toMatchObject({ word: "Paused", fill: "paused" });
    expect(internetMarkLook(group(), [bedtime], TZ, at("2026-09-28T23:00:00"))).toMatchObject({ word: "Off", fill: "accent" });
    expect(internetMarkLook(group(), [bedtime], TZ, noon)).toMatchObject({ word: "On", fill: "field" });
    expect(internetMarkLook(group(), [], TZ, noon)).toEqual({ word: "No rule", fill: null, ink: "ink-3", wordInk: "ink-2", border: "dashed" });
  });

  it("uses a group's own monogram, else the first two letters of its name, at most four", () => {
    expect(groupMonogram({ monogram: null, name: "Printers" })).toBe("Pr");
    expect(groupMonogram({ monogram: "TVROOM", name: "Living room" })).toBe("TVRO");
    expect(personMonogram({ monogram: null, name: " emma" })).toBe("E");
    expect(personMonogram({ monogram: "EJ", name: "Emma" })).toBe("EJ");
  });
});
