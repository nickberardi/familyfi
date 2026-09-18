import { describe, expect, it } from "vitest";
import {
  categoryMarkLabel,
  categoryMarkState,
  categoryMarkWord,
  type UpstreamCheckRow,
} from "@/lib/upstream";

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

describe("category mark state", () => {
  /** The rule: an enabled FamilyFi policy is the state shown, whatever DNS says. */
  it("lets an enabled rule win over every DNS verdict", () => {
    for (const verdict of ["blocked", "partial", "open", "unknown"] as const) {
      expect(categoryMarkState(true, check(verdict)), verdict).toBe("on");
    }
    expect(categoryMarkState(true, null)).toBe("on");
  });

  it("falls back to DNS when no rule is blocking", () => {
    expect(categoryMarkState(false, check("blocked"))).toBe("blocked");
    expect(categoryMarkState(false, check("partial"))).toBe("partial");
    expect(categoryMarkState(false, check("open"))).toBe("off");
  });

  /**
   * A rule that exists but is turned off is not blocking anything, so it must not
   * mask what the resolver is actually doing.
   */
  it("does not let a disabled rule mask the DNS verdict", () => {
    expect(categoryMarkState(false, check("blocked"))).toBe("blocked");
  });

  it("shows off when nothing is known", () => {
    expect(categoryMarkState(false, check("unknown"))).toBe("off");
    expect(categoryMarkState(false, null)).toBe("off");
  });

  it("names each state for a reader and for a screen reader", () => {
    expect(categoryMarkWord("on")).toBe("On");
    expect(categoryMarkWord("blocked")).toBe("DNS");
    expect(categoryMarkWord("partial")).toBe("Part");
    expect(categoryMarkWord("off")).toBe("Off");

    expect(categoryMarkLabel("Video", "on")).toBe("Video blocked by FamilyFi");
    expect(categoryMarkLabel("Video", "blocked")).toBe("Video already blocked by DNS");
    expect(categoryMarkLabel("Video", "partial")).toBe("Video partially blocked by DNS");
    expect(categoryMarkLabel("Video", "off")).toBe("Video not blocked");
  });
});
