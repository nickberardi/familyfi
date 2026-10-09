import { describe, expect, it } from "vitest";
import { UPDATE_RUN_TIMEOUT_MS, updateOutcome, updaterSettings, type WatchtowerHistory } from "@/server/updater";

const requestedAt = new Date("2026-10-11T04:00:00.000Z");
const soon = new Date(requestedAt.getTime() + 60_000);
const history = (counts: Partial<WatchtowerHistory>): WatchtowerHistory => ({ scans: 1, updated: 0, failed: 0, skipped: 0, ...counts });

describe("updaterSettings", () => {
  it("is set up only with a token, at the Compose service by default", () => {
    expect(updaterSettings({})).toBeNull();
    expect(updaterSettings({ FAMILYFI_UPDATER_TOKEN: "  " })).toBeNull();
    expect(updaterSettings({ FAMILYFI_UPDATER_TOKEN: "secret" })).toEqual({ url: "http://watchtower:8080", token: "secret" });
    expect(updaterSettings({ FAMILYFI_UPDATER_TOKEN: "secret", FAMILYFI_UPDATER_URL: "http://192.0.2.5:8080/" })).toEqual({
      url: "http://192.0.2.5:8080",
      token: "secret",
    });
  });
});

describe("updateOutcome", () => {
  const base = { targetVersion: "0.28.0", currentVersion: "0.27.0", requestedAt, now: soon };

  it("succeeds once the offered release, or a newer one, is running, whatever Watchtower says", () => {
    expect(updateOutcome({ ...base, currentVersion: "0.28.0", history: null })).toEqual({ status: "succeeded", error: null });
    expect(updateOutcome({ ...base, currentVersion: "0.28.1", history: history({ failed: 1 }) })?.status).toBe("succeeded");
  });

  it("reads Watchtower's scans when the old release is still running", () => {
    expect(updateOutcome({ ...base, history: history({ failed: 1, skipped: 1 }) })?.status).toBe("failed");
    expect(updateOutcome({ ...base, history: history({ updated: 1 }) })).toEqual({
      status: "failed",
      error: "Watchtower replaced the container, but it runs v0.27.0, not v0.28.0.",
    });
    expect(updateOutcome({ ...base, history: history({ skipped: 1 }) })?.status).toBe("skipped");
    expect(updateOutcome({ ...base, history: history({}) })?.status).toBe("unchanged");
  });

  it("stays open until Watchtower finishes a scan or the time limit passes", () => {
    expect(updateOutcome({ ...base, history: null })).toBeNull();
    expect(updateOutcome({ ...base, history: history({ scans: 0 }) })).toBeNull();
    const late = new Date(requestedAt.getTime() + UPDATE_RUN_TIMEOUT_MS + 1);
    expect(updateOutcome({ ...base, now: late, history: null })).toEqual({
      status: "failed",
      error: "Watchtower did not report a result within 30 minutes.",
    });
  });
});
