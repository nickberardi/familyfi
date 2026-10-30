import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupFailureSince, UPDATE_RUN_TIMEOUT_MS, updateOutcome, updaterSettings, type WatchtowerHistory } from "@/server/updater";

const requestedAt = new Date("2026-10-11T04:00:00.000Z");
const soon = new Date(requestedAt.getTime() + 60_000);
const history = (counts: Partial<WatchtowerHistory>): WatchtowerHistory => ({ scans: 1, scanned: 1, updated: 0, failed: 0, skipped: 0, scanFailed: 0, ...counts });

describe("updaterSettings", () => {
  it("reads the shared token from the updater volume, and is nothing without it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-updater-"));
    const file = path.join(dir, "token");
    expect(updaterSettings({}, file)).toBeNull();
    writeFileSync(file, "  \n");
    expect(updaterSettings({}, file)).toBeNull();
    writeFileSync(file, "secret\n");
    expect(updaterSettings({}, file)).toEqual({ url: "http://watchtower:8080", token: "secret" });
    expect(updaterSettings({ FAMILYFI_UPDATER_URL: "http://192.0.2.5:8080/" }, file)).toEqual({ url: "http://192.0.2.5:8080", token: "secret" });
  });
});

describe("backupFailureSince", () => {
  it("reads why the backup failed, only when it failed since the request", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-backups-"));
    const file = path.join(dir, "last-failure");
    expect(backupFailureSince(requestedAt, file)).toBeNull();
    writeFileSync(file, "pg_dump failed\n");
    utimesSync(file, soon, soon);
    expect(backupFailureSince(requestedAt, file)).toBe("pg_dump failed");
    const before = new Date(requestedAt.getTime() - 60_000);
    utimesSync(file, before, before);
    expect(backupFailureSince(requestedAt, file)).toBeNull();
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
    // An older Watchtower that does not report what it looked at.
    expect(updateOutcome({ ...base, history: history({ scanned: null }) })?.status).toBe("unchanged");
  });

  it("says the backup failed when Watchtower skipped the update because of it", () => {
    // Watchtower 1.23.1 and later counts the hook's exit 75 as a skip.
    expect(updateOutcome({ ...base, history: history({ skipped: 1 }), backupFailure: "pg_dump failed" })).toEqual({
      status: "failed",
      error: "The backup before installing failed (pg_dump failed), so FamilyFi kept running v0.27.0. The FamilyFi log says more.",
    });
    expect(updateOutcome({ ...base, history: history({ skipped: 1 }), backupFailure: null })?.status).toBe("skipped");
  });

  it("tells a scan that failed, or looked at no container, from one that found nothing newer", () => {
    expect(updateOutcome({ ...base, history: history({ scanned: 0, scanFailed: 1 }) })).toEqual({
      status: "failed",
      error: "Watchtower could not look for a newer image; its log says why.",
    });
    expect(updateOutcome({ ...base, history: history({ scanned: 0 }) })).toEqual({
      status: "failed",
      error: "Watchtower looked at no container. FamilyFi's container needs the Watchtower labels in the current docker-compose.yml; Watchtower's log says more.",
    });
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
