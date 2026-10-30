import { describe, expect, it } from "vitest";
import { installCopy, installCountdownLine, installedVersion, checkedLine, installing, latestRelease, updateRunLine, updateScheduleLine, versionLabel } from "@/lib/update-copy";
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
    expect(installCopy("v0.6.0")).toEqual({ title: "Install v0.6.0", button: "Install v0.6.0 · needs the updater" });
    expect(installCopy("v0.6.0", true)).toEqual({ title: "Install v0.6.0", button: "Install v0.6.0" });
  });

  it("says when the server last checked, or that it could not", () => {
    const now = Date.parse("2026-10-30T12:05:00.000Z");
    expect(checkedLine(null, now)).toBe("Checking for updates…");
    expect(checkedLine(check({ status: "pending" }), now)).toBe("Checking for updates…");
    expect(checkedLine(check({ available: false, checkedAt: "2026-10-30T12:03:00.000Z" }), now)).toBe("Checked 2m ago");
    expect(checkedLine(check({ checkedAt: "2026-10-30T12:04:30.000Z" }), now)).toBe("Checked just now");
    expect(checkedLine(check({ status: "error", available: null, checkedAt: "2026-10-30T11:05:00.000Z" }), now)).toBe("Could not reach GitHub, 1h ago");
  });
});

const run = (over: Partial<UpdateRun> = {}): UpdateRun => ({
  targetVersion: "0.6.0",
  status: "requested",
  requestedAt: "2026-10-11T04:00:00.000Z",
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
    expect(updateRunLine(run({ status: "failed", error: "Watchtower refused FamilyFi's updater token." }))).toBe(
      "Installing v0.6.0 failed. Watchtower refused FamilyFi's updater token.",
    );
    expect(updateRunLine(run({ status: "unchanged", error: "No newer image." }))).toBe("v0.6.0 was not installed. No newer image.");
    expect(installing(settings({ lastRun: run() }))).toBe(true);
    expect(installing(settings({ lastRun: run({ status: "succeeded" }) }))).toBe(false);
  });

  it("drops an install the running release has moved past", () => {
    // Running v0.6.0: an install of it still says so, and one still under way still shows.
    expect(updateRunLine(run({ status: "succeeded" }), "0.6.0")).toBe("Installed v0.6.0.");
    expect(updateRunLine(run(), "0.7.0")).toMatch(/^Installing v0.6.0/);
    // Running v0.7.0, an older install's outcome is history, not what is installed.
    expect(updateRunLine(run({ status: "succeeded" }), "0.7.0")).toBeNull();
    expect(updateRunLine(run({ status: "failed", error: "No." }), "0.7.0")).toBeNull();
    expect(updateRunLine(run({ status: "unchanged", error: "No." }), "v0.7.0")).toBeNull();
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

describe("install countdown", () => {
  const at = (seconds: number) => new Date(Date.parse("2026-10-11T04:00:00.000Z") + seconds * 1000);

  it("counts down two minutes from the request", () => {
    expect(installCountdownLine("2026-10-11T04:00:00.000Z", at(0))).toBe("About 2:00 left");
    expect(installCountdownLine("2026-10-11T04:00:00.000Z", at(15))).toBe("About 1:45 left");
    expect(installCountdownLine("2026-10-11T04:00:00.000Z", at(119.2))).toBe("About 0:01 left");
  });

  it("says it is taking longer once two minutes have passed", () => {
    expect(installCountdownLine("2026-10-11T04:00:00.000Z", at(120))).toBe("Taking longer than usual, still installing…");
    expect(installCountdownLine("2026-10-11T04:00:00.000Z", at(900))).toBe("Taking longer than usual, still installing…");
  });

  it("counts from when this device first saw the install when the request is ahead of its clock", () => {
    expect(installCountdownLine("2026-10-11T04:05:00.000Z", at(0))).toBe("About 2:00 left");
    expect(installCountdownLine("2026-10-11T04:05:00.000Z", at(30), at(0))).toBe("About 1:30 left");
  });

  it("knows the new release by its version, with or without the v, or a newer one", () => {
    expect(installedVersion("0.6.0", "v0.6.0")).toBe(true);
    expect(installedVersion("0.6.1", "0.6.0")).toBe(true);
    expect(installedVersion("0.5.1", "0.6.0")).toBe(false);
    expect(installedVersion("0.6.0-rc.1", "0.6.0")).toBe(false);
  });
});
