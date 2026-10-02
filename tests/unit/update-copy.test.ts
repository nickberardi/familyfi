import { describe, expect, it } from "vitest";
import { installCopy, latestRelease, upToDateLine, updateAlert, versionLabel } from "@/lib/update-copy";
import type { UpdateCheck } from "@/lib/types";

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
    expect(installCopy("v0.6.0")).toEqual({ title: "Install v0.6.0", button: "Install v0.6.0 · coming soon" });
  });

  it("says what the check found when nothing is newer", () => {
    expect(upToDateLine(null)).toBe("Checking for updates…");
    expect(upToDateLine(check({ status: "pending" }))).toBe("Checking for updates…");
    expect(upToDateLine(check({ status: "error", available: null }))).toBe("Update check unavailable.");
    expect(upToDateLine(check({ available: false }))).toBe("FamilyFi v0.5.1 is up to date.");
  });
});
