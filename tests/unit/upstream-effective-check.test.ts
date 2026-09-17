import { describe, expect, it } from "vitest";
import {
  effectiveCheck,
  usesOwnResolver,
  type UpstreamCheckRow,
  type UpstreamGroupContext,
} from "@/lib/upstream";

function check(groupId: string | null, verdict: UpstreamCheckRow["verdict"]): UpstreamCheckRow {
  return {
    groupId,
    verdict,
    blockedCount: verdict === "blocked" ? 20 : 0,
    totalCount: 20,
    checkedAt: "2026-09-17T12:00:00.000Z",
    error: null,
  };
}

const HOUSEHOLD = check(null, "open");
const BETSY: UpstreamGroupContext = { id: "grp-betsy", dohOverrideUrl: "https://strict.example/dns-query" };
const NICK: UpstreamGroupContext = { id: "grp-nick", dohOverrideUrl: null };

describe("effective check", () => {
  /**
   * The rule the product turns on: two cards on the same page, different endpoints,
   * different answers. Betsy's card must never show the household's verdict.
   */
  it("gives each card its own resolver's answer on the same page", () => {
    const checks = [HOUSEHOLD, check(BETSY.id, "blocked")];

    expect(effectiveCheck(checks, BETSY)?.verdict).toBe("blocked");
    expect(effectiveCheck(checks, NICK)?.verdict).toBe("open");
  });

  it("falls back to the household for a group with no override", () => {
    const checks = [HOUSEHOLD, check(BETSY.id, "blocked")];
    expect(effectiveCheck(checks, NICK)).toBe(HOUSEHOLD);
    // A group row that exists but belongs to someone else is not a fallback.
    expect(effectiveCheck([check(BETSY.id, "blocked")], NICK)).toBeNull();
  });

  it("asks the household question when no group is given", () => {
    const checks = [HOUSEHOLD, check(BETSY.id, "blocked")];
    expect(effectiveCheck(checks)).toBe(HOUSEHOLD);
    expect(effectiveCheck(checks, null)).toBe(HOUSEHOLD);
  });

  /**
   * Between setting an override and the next sweep there is no row for that group.
   * Null becomes "Not checked", which is honest — silently showing the household's
   * verdict would be the wrong answer presented as the right one.
   */
  it("reports nothing rather than the household answer before the first sweep", () => {
    expect(effectiveCheck([HOUSEHOLD], BETSY)).toBeNull();
  });

  it("knows which cards are reporting their own endpoint", () => {
    expect(usesOwnResolver(BETSY)).toBe(true);
    expect(usesOwnResolver(NICK)).toBe(false);
    expect(usesOwnResolver(null)).toBe(false);
    expect(usesOwnResolver()).toBe(false);
  });

  it("returns null when nothing has been checked at all", () => {
    expect(effectiveCheck([], BETSY)).toBeNull();
    expect(effectiveCheck([], NICK)).toBeNull();
  });
});
