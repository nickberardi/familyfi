import { describe, expect, it } from "vitest";
import { allowanceEndingNotice, PAUSE_ENDING_LEAD_MS, pauseEndingNotice } from "@/lib/pause-ending";

const NOW = Date.parse("2026-11-12T20:00:00Z");

describe("pause ending notice", () => {
  it("shows five minutes before the block ends and names the group", () => {
    const until = NOW + 30 * 60_000;
    expect(pauseEndingNotice({ name: "Gaming" }, until, NOW)).toEqual({
      at: until - PAUSE_ENDING_LEAD_MS,
      title: "Block for Gaming ends in 5 minutes",
      body: "Internet comes back then. Choose More time to keep it blocked.",
    });
  });

  it("is not shown for a block that ends within five minutes", () => {
    expect(pauseEndingNotice({ name: "Gaming" }, NOW + PAUSE_ENDING_LEAD_MS, NOW)).toBeNull();
    expect(pauseEndingNotice({ name: "Gaming" }, NOW - 1, NOW)).toBeNull();
  });

  it("says the same of an unblock, which ends with the group's rules back on", () => {
    const until = NOW + 20 * 60_000;
    expect(allowanceEndingNotice({ name: "Sam" }, until, NOW)).toEqual({
      at: until - PAUSE_ENDING_LEAD_MS,
      title: "Unblock for Sam ends in 5 minutes",
      body: "Its rules apply again then. Choose More time to keep it unblocked.",
    });
    expect(allowanceEndingNotice({ name: "Sam" }, NOW + PAUSE_ENDING_LEAD_MS, NOW)).toBeNull();
  });
});
