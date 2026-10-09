import { describe, expect, it } from "vitest";
import { installCopy, installing, latestRelease, upToDateLine, updateAlert, updateRunLine, updateScheduleLine, versionLabel } from "@/lib/update-copy";
import type { UpdateCheck, UpdateRun, UpdateSettings } from "@/lib/types";

const check = (over: Partial<UpdateCheck> = {}): UpdateCheck => ({
  status: "ok",
  available: true,
  currentVersion: "0.5.1",
  latestVersion: "v0.6.0",
  releaseUrl: null,
  releaseNotes: null,
  checkedAt: null,
  lastSuccessfulAt: null,
  error: null,
  ...over,
});

describe("update copy", () => {
  it("names releases with one v", () => {
    expect(versionLabel("0.5.1")).toBe("v0.5.1");
    expect(versionLabel("V0.6.0")).toBe("v0.6.0");
  });

  it("offers the newer release, and only when there is one", () => {
    expect(latestRelease(check())).toBe("v0.6.0");
    expect(latestRelease(check({ available: false }))).toBeNull();
    expect(latestRelease(check({ latestVersion: null }))).toBeNull();
    expect(updateAlert(check())).toEqual({ title: "Update available", body: "v0.6.0 is ready. You’re on v0.5.1.", action: "Update", href: "/update" });
    expect(updateAlert(null)).toBeNull();
    expect(installCopy("v0.6.0")).toEqual({ title: "Install v0.6.0", button: "Install v0.6.0 · needs the updater" });
    expect(installCopy("v0.6.0", true)).toEqual({ title: "Install v0.6.0", button: "Install v0.6.0" });
  });

  it("says what the check found when nothing is newer", () => {
    expect(upToDateLine(null)).toBe("Checking for updates…");
    expect(upToDateLine(check({ status: "pending" }))).toBe("Checking for updates…");
    expect(upToDateLine(check({ status: "error", available: null }))).toBe("Update check unavailable.");
    expect(upToDateLine(check({ available: false }))).toBe("FamilyFi v0.5.1 is up to date.");
  });
});

const run = (over: Partial<UpdateRun> = {}): UpdateRun => ({
  id: "run",
  trigger: "manual",
  fromVersion: "0.5.1",
  targetVersion: "0.6.0",
  status: "requested",
  requestedAt: "2026-10-11T04:00:00.000Z",
  finishedAt: null,
  error: null,
  ...over,
});

const settings = (over: Partial<UpdateSettings> = {}): UpdateSettings => ({
  updater: { configured: true },
  schedule: { enabled: true, days: [0], time: "00:00" },
  nextRunAt: "2026-10-11T04:00:00.000Z",
  lastRun: null,
  ...over,
});

describe("install progress and schedule", () => {
  it("says where the last install stands", () => {
    expect(updateRunLine(null)).toBeNull();
    expect(updateRunLine(run())).toBe("Installing v0.6.0… FamilyFi restarts on its own; this page reconnects by itself.");
    expect(updateRunLine(run({ status: "succeeded" }))).toBe("Installed v0.6.0.");
    expect(updateRunLine(run({ status: "failed", error: "Watchtower refused FAMILYFI_UPDATER_TOKEN." }))).toBe(
      "Installing v0.6.0 failed. Watchtower refused FAMILYFI_UPDATER_TOKEN.",
    );
    expect(updateRunLine(run({ status: "unchanged", error: "No newer image." }))).toBe("v0.6.0 was not installed. No newer image.");
    expect(installing(settings({ lastRun: run() }))).toBe(true);
    expect(installing(settings({ lastRun: run({ status: "succeeded" }) }))).toBe(false);
  });

  it("names the schedule in the household's time, or why there is none", () => {
    // Saturday evening in New York; the next run is Sunday at midnight there.
    const now = new Date("2026-10-10T20:00:00.000Z");
    expect(updateScheduleLine(settings(), "America/New_York", now)).toBe("Sunday at 12 AM · next tomorrow");
    expect(updateScheduleLine(settings({ schedule: { enabled: false, days: [0], time: "00:00" } }), "America/New_York", now)).toBe(
      "Off — install from this page",
    );
    expect(updateScheduleLine(settings({ updater: { configured: false }, nextRunAt: null }), "America/New_York", now)).toMatch(/need the Watchtower updater/);
  });
});
