import { describe, expect, it } from "vitest";
import {
  appMarkState,
  categoryMarkLabel,
  categoryMarkState,
  categoryMarkStyle,
  categoryMarkWord,
  ruleActivelyBlocking,
  type UpstreamCheckRow,
} from "@/lib/upstream";

const ZONE = "America/New_York";

/** A rule as the client sees it. Bedtime is 21:30–06:45 on school nights. */
function rule(overrides: Partial<{
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
}> = {}) {
  return {
    enabled: true,
    mode: "scheduled" as const,
    schedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" },
    ...overrides,
  };
}

/** A Thursday, in New York local terms. */
const inWindow = new Date("2026-09-17T23:00:00-04:00"); // 23:00 Thu — inside bedtime
const outOfWindow = new Date("2026-09-17T15:00:00-04:00"); // 15:00 Thu — outside

function check(verdict: UpstreamCheckRow["verdict"]): UpstreamCheckRow {
  return {
    verdict,
    blockedCount: verdict === "blocked" ? 20 : verdict === "partial" ? 6 : 0,
    totalCount: 20,
    checkedAt: "2026-09-18T09:00:00.000Z",
    error: null,
    groupId: null,
  };
}

describe("actively blocking", () => {
  it("is false for a rule that is switched off", () => {
    expect(ruleActivelyBlocking(rule({ enabled: false }), ZONE, inWindow)).toBe(false);
  });

  it("is true for an always-on rule at any hour", () => {
    expect(ruleActivelyBlocking(rule({ mode: "always" }), ZONE, outOfWindow)).toBe(true);
  });

  /** The correction: on, but outside its hours, is not blocking anything. */
  it("follows the window for a scheduled rule", () => {
    expect(ruleActivelyBlocking(rule(), ZONE, inWindow)).toBe(true);
    expect(ruleActivelyBlocking(rule(), ZONE, outOfWindow)).toBe(false);
  });

  it("respects the days a schedule runs", () => {
    // 23:00 on a Saturday — inside the clock window, but not a school night.
    const saturday = new Date("2026-09-19T23:00:00-04:00");
    expect(ruleActivelyBlocking(rule(), ZONE, saturday)).toBe(false);
  });

  it("evaluates the window in the household's zone, not the server's", () => {
    // The same instant: 23:00 Thursday in New York, inside bedtime — but midday
    // Friday in Tokyo, which is not. London is deliberately not used here: 04:00
    // there still falls inside the overnight window, so it proves nothing.
    expect(ruleActivelyBlocking(rule(), "America/New_York", inWindow)).toBe(true);
    expect(ruleActivelyBlocking(rule(), "Asia/Tokyo", inWindow)).toBe(false);
  });

  it("treats a missing or malformed schedule as not blocking rather than throwing", () => {
    expect(ruleActivelyBlocking(rule({ schedule: { enabled: false, days: [], start: null, end: null } }), ZONE, inWindow)).toBe(false);
    expect(ruleActivelyBlocking(rule({ schedule: { enabled: true, days: [1], start: "nope", end: "06:45" } }), ZONE, inWindow)).toBe(false);
    expect(ruleActivelyBlocking(undefined, ZONE, inWindow)).toBe(false);
  });
});

describe("category mark state", () => {
  /** The rule: a policy that is blocking right now is the state shown, whatever DNS says. */
  it("lets an actively blocking rule win over every DNS verdict", () => {
    for (const verdict of ["blocked", "partial", "open", "unknown"] as const) {
      expect(categoryMarkState(true, check(verdict)), verdict).toBe("on");
    }
    expect(categoryMarkState(true, null)).toBe("on");
  });

  it("falls back to DNS when no rule is blocking", () => {
    expect(categoryMarkState(false, check("blocked"))).toBe("blocked");
    expect(categoryMarkState(false, check("partial"))).toBe("partial");
    expect(categoryMarkState(false, check("open"))).toBe("open");
  });

  /**
   * The whole point of the correction: a rule that is switched on but outside its
   * schedule is blocking nothing, so it must not mask a resolver that is.
   */
  it("does not let an idle scheduled rule mask the DNS verdict", () => {
    const blocking = ruleActivelyBlocking(rule(), ZONE, outOfWindow);
    expect(blocking).toBe(false);
    expect(categoryMarkState(blocking, check("blocked"))).toBe("blocked");
    // And inside its hours the policy is what the mark reports.
    expect(categoryMarkState(ruleActivelyBlocking(rule(), ZONE, inWindow), check("blocked"))).toBe("on");
  });

  /**
   * The state that pays for itself: a measured all-clear is green, and an unmeasured
   * category must not borrow that green. Both mean "nothing of ours is blocking it",
   * but only one of them is a claim about the resolver.
   */
  it("keeps never-looked apart from looked-and-clear", () => {
    expect(categoryMarkState(false, check("unknown"))).toBe("unknown");
    expect(categoryMarkState(false, null)).toBe("unknown");
    expect(categoryMarkState(false, check("open"))).toBe("open");
    expect(categoryMarkStyle("unknown")).not.toEqual(categoryMarkStyle("open"));
  });

  /** An app rule has no resolver behind it, so an app mark can never claim green. */
  it("never reports an app mark as measured-open", () => {
    expect(appMarkState(true)).toBe("on");
    expect(appMarkState(false)).toBe("unknown");
  });

  it("names each state for a reader and for a screen reader", () => {
    // Both blocking states read the same word; the colour answers who is blocking.
    expect(categoryMarkWord("on")).toBe("blocked");
    expect(categoryMarkWord("blocked")).toBe("blocked");
    expect(categoryMarkWord("partial")).toBe("partial");
    // Nothing blocking gets no word at all — the fill carries it.
    expect(categoryMarkWord("open")).toBe("");
    expect(categoryMarkWord("unknown")).toBe("");

    expect(categoryMarkLabel("Video", "on")).toBe("Video blocked by FamilyFi");
    expect(categoryMarkLabel("Video", "blocked")).toBe("Video already blocked by DNS");
    expect(categoryMarkLabel("Video", "partial")).toBe("Video partially blocked by DNS");
    expect(categoryMarkLabel("Video", "open")).toBe("Video not blocked");
    expect(categoryMarkLabel("Video", "unknown")).toBe("Video not blocked by FamilyFi");
  });

  /**
   * The colours themselves, because the words alone do not distinguish `on` from
   * `blocked` and a swap between them would misattribute the block to FamilyFi.
   */
  it("gives every state its own fill, and reuses no colour across two meanings", () => {
    const states = ["on", "blocked", "partial", "open", "unknown"] as const;
    const fills = states.map((state) => categoryMarkStyle(state).fill);
    expect(new Set(fills).size).toBe(states.length);
    expect(categoryMarkStyle("on").ink).toBe("var(--ff-danger)");
    expect(categoryMarkStyle("open").ink).toBe("var(--ff-on-ink)");
    // Every colour is a token; a literal here would sail past naming.test.ts.
    for (const state of states) {
      const style = categoryMarkStyle(state);
      expect(style.fill).toMatch(/^var\(--ff-[a-z0-9-]+\)$/);
      expect(style.ink).toMatch(/^var\(--ff-[a-z0-9-]+\)$/);
    }
  });
});
