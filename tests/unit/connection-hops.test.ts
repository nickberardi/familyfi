import { describe, expect, it } from "vitest";
import { OFFLINE_AFTER_FAILURES, changeHop, gatewayHop, hopLinks, isOffline, phoneHop, retryDelay } from "@/lib/connection-hops";
import type { SyncStatus } from "@/lib/types";

const route = { url: "https://home.example", transport: "lan", trustMode: "pinned", spkiSha256: "abcdefghijklmnopqrstuvwxyz", edgeAuth: "none" } as const;
const sync = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  revision: 1,
  connectionStatus: "ok",
  appPolicyCount: 0,
  failingCount: 0,
  issues: [],
  lastRun: { id: "r", status: "applied", requestedRevision: 1, appliedRevision: 1, startedAt: "2026-09-14T19:50:00Z", finishedAt: "2026-09-14T19:58:00Z", error: null },
  changes: [],
  ...over,
});

describe("connection hops", () => {
  it("retries quickly, then steadily, and says offline only after failures in a row", () => {
    expect([1, 2, 3, 4, 9].map(retryDelay)).toEqual([2_000, 4_000, 8_000, 15_000, 15_000]);
    expect(isOffline(OFFLINE_AFTER_FAILURES - 1)).toBe(false);
    expect(isOffline(OFFLINE_AFTER_FAILURES)).toBe(true);
    expect(OFFLINE_AFTER_FAILURES).toBeGreaterThan(1);
  });

  it("reports this phone's hop as measured", () => {
    expect(phoneHop("connected", route)).toMatchObject({ tone: "var(--ff-on)", status: "Connected", footnote: "My domain · https://home.example" });
    expect(phoneHop("connected", route).detail).toMatch(/^Pinned certificate .+\. Measured from this phone/);
    expect(phoneHop("offline", null)).toMatchObject({ tone: "var(--ff-danger)", status: "Not connected", footnote: null });
    expect(phoneHop("checking", null).status).toBe("Checking…");
  });

  it("relays the gateway hop from the server", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    expect(gatewayHop({ connectionStatus: "connected", connectionError: null }, sync(), "connected", now)).toMatchObject({ tone: "var(--ff-on)", status: "Connected", footnote: "Last sweep 2m" });
    expect(gatewayHop({ connectionStatus: "error", connectionError: "401 from the console" }, null, "connected", now)).toMatchObject({ tone: "var(--ff-danger)", detail: "401 from the console", footnote: null });
    expect(gatewayHop(null, null, "connected", now)).toMatchObject({ status: "Unknown", tone: "var(--ff-muted)" });
    expect(gatewayHop({ connectionStatus: "connected", connectionError: null }, sync(), "checking", now).status).toBe("Connected");
  });

  it("does not claim the gateway hop while this phone cannot ask", () => {
    const now = new Date("2026-09-14T20:00:00Z");
    expect(gatewayHop({ connectionStatus: "connected", connectionError: null }, sync(), "offline", now)).toMatchObject({
      tone: "var(--ff-muted)",
      status: "Unknown",
      detail: "This phone can't reach FamilyFi to ask. Last reported: Connected.",
      footnote: "Last sweep 2m",
    });
    expect(gatewayHop(null, null, "offline", now)).toMatchObject({ status: "Unknown", detail: "This phone can't reach FamilyFi to ask.", footnote: null });
  });

  it("shows the latest change's outcome", () => {
    expect(changeHop(null, "UTC").status).toBe("Nothing yet");
    const applied = sync({ changes: [{ id: "c", revision: 1, appliedRevision: 1, status: "applied", scope: "pause", deviceMac: null, error: null, updatedAt: "2026-09-14T19:58:00Z" }] });
    expect(changeHop(applied, "UTC")).toMatchObject({ status: "Applied", detail: "Pause all internet: the gateway has the requested state.", footnote: "Sep 14, 7:58 PM" });
    const failed = sync({ changes: [{ id: "c", revision: 1, appliedRevision: null, status: "failed", scope: "pause", deviceMac: null, error: "UniFi timed out", updatedAt: "2026-09-14T19:58:00Z" }] });
    expect(changeHop(failed, "UTC")).toMatchObject({ status: "Failed", tone: "var(--ff-danger)", detail: "UniFi timed out" });
  });

  it("marks the diagram's links", () => {
    expect(hopLinks("connected", { connectionStatus: "connected" })).toEqual({
      phone: { tone: "var(--ff-on)", mark: "ok", label: "Connected" },
      unifi: { tone: "var(--ff-on)", mark: "ok", label: "Connected" },
    });
    expect(hopLinks("checking", { connectionStatus: "error" })).toEqual({
      phone: { tone: "var(--ff-paused)", mark: "checking", label: "Checking" },
      unifi: { tone: "var(--ff-danger)", mark: "failed", label: "Error" },
    });
    expect(hopLinks("connected", { connectionStatus: "unconfigured" }).unifi).toEqual({ tone: "var(--ff-muted)", mark: "off", label: "Not configured" });
    expect(hopLinks("connected", null).unifi).toEqual({ tone: "var(--ff-muted)", mark: "unknown", label: "Unknown" });
  });

  it("never shows the server's last answer as current while this phone is offline", () => {
    expect(hopLinks("offline", { connectionStatus: "connected" })).toEqual({
      phone: { tone: "var(--ff-danger)", mark: "failed", label: "Not connected" },
      unifi: { tone: "var(--ff-muted)", mark: "unknown", label: "Unknown" },
    });
  });
});
