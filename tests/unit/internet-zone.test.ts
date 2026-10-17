import { describe, expect, it } from "vitest";
import { groupMonogram, internetMarkLook, personMonogram } from "@/lib/internet-zone";
import type { InternetWindow } from "@/lib/rule-windows";

const TZ = "America/New_York";
// Monday 28 September 2026 is EDT, UTC−4.
const at = (local: string) => new Date(`${local}-04:00`);
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const bedtime: InternetWindow = { name: "", days: EVERY_DAY, start: "22:00", end: "06:00", ruleName: "Bedtime" };

const group = (patch: Partial<{ name: string; deviceCount: number; suspension: { active: boolean; until: string | null; by: null }; allowance: { active: boolean; until: string | null; by: null } }> = {}) => ({
  name: "A child group",
  deviceCount: 2,
  suspension: { active: false, until: null, by: null },
  allowance: { active: false, until: null, by: null },
  ...patch,
});

describe("internet mark", () => {
  it("marks a closed card's internet as Paused, Off, On or No rule, in token names", () => {
    const noon = at("2026-09-28T12:00:00");
    expect(internetMarkLook(group({ suspension: { active: true, until: null, by: null } }), [], TZ, noon)).toMatchObject({ word: "Blocked", fill: "paused" });
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
