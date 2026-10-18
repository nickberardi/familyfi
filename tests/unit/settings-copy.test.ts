import { describe, expect, it } from "vitest";
import { createLoginTitle, formatUptime, gatewayFacts, gatewayHealthFacts, requestLoadLine, householdMemberNote, keyStatusLine, loginFormState, recoveryNote, removeAdminConfirm, removeLoginConfirm, settingsTab, usernameFromName } from "@/lib/settings-copy";
import type { GatewayDeviceHealth, UnifiSettings } from "@/lib/types";

const unifi: UnifiSettings = {
  configured: true,
  mode: "local",
  baseUrl: "https://10.1.2.1/proxy/network/integration",
  consoleId: null,
  siteId: "default",
  apiKeyMasked: "••••4f2c",
  tlsInsecure: true,
  manageAllNetworks: false,
  managedNetworkIds: ["net-1"],
  networks: [
    { id: "net-1", name: "Family", vlanId: 1, zoneId: "z1" },
    { id: "net-2", name: "Guest", vlanId: 2, zoneId: "z1" },
  ],
  connectionStatus: "connected",
  connectionError: null,
};

describe("settings copy", () => {
  it("lists gateway facts from saved UniFi settings", () => {
    const facts = gatewayFacts(unifi);
    expect(facts.find((row) => row.k === "Host")?.v).toBe("10.1.2.1");
    expect(facts.find((row) => row.k === "Networks")?.v).toBe("Family");
    expect(facts.find((row) => row.k === "Status")?.v).toBe("Connected");
  });

  it("describes family members without claiming kids can log in", () => {
    expect(householdMemberNote({ familyRole: "child", deviceCount: 2 })).toBe("Child · pause and bedtime · 2 devices");
    expect(
      householdMemberNote(
        { familyRole: "adult", deviceCount: 1 },
        {
          id: "a1",
          username: "melinda",
          displayName: "Melinda",
          kind: "personal",
          isAdmin: true,
          groupId: "g1",
          recovery: false,
        },
      ),
    ).toContain("admin · login melinda");
    // Only administrators use FamilyFi: a login without it says it cannot sign in.
    expect(
      householdMemberNote(
        { familyRole: "adult", deviceCount: 0 },
        { id: "a2", username: "sam", displayName: "Sam", kind: "personal", isAdmin: false, groupId: "g2", recovery: false },
      ),
    ).toBe("Adult · login sam · not an admin, can't sign in · 0 devices");
  });

  it("asks before turning admin off, since that signs the adult out and removes their devices", () => {
    const confirm = removeAdminConfirm({ username: "sam" }, { name: "Sam" });
    expect(confirm.confirmLabel).toBe("Turn off admin");
    expect(confirm.message).toContain("signed out");
    expect(confirm.message).toContain("phones, Watches and agents");
  });

  it("suggests a personal username from a given name", () => {
    expect(usernameFromName("Melinda")).toBe("melinda");
  });

  it("explains the key's state, worst news first", () => {
    const age = () => "2m";
    expect(keyStatusLine({ connectionError: "401 from the console" }, "2026-09-14T19:58:00Z", age)).toBe("401 from the console");
    expect(keyStatusLine({ connectionError: null }, "2026-09-14T19:58:00Z", age)).toBe("Last sweep 2m");
    expect(keyStatusLine(null, null, age)).toBe("Save a key to start discovery and quarantine.");
  });

  it("checks a new login's passwords before it can be created", () => {
    expect(loginFormState("ab", "short", "short")).toEqual({ hint: "At least 8 characters.", passwordsOk: false, canCreate: false });
    expect(loginFormState("ab", "longenough", "different")).toMatchObject({ hint: "The two passwords must match.", canCreate: false });
    expect(loginFormState("a", "longenough", "longenough")).toMatchObject({ passwordsOk: true, canCreate: false });
    expect(loginFormState("adult", "longenough", "longenough")).toEqual({ hint: "Looks good — this login is only for FamilyFi.", passwordsOk: true, canCreate: true });
  });

  it("names the recovery admin, a new login and removing one", () => {
    expect(recoveryNote({ username: "admin" })).toBe("Recovery admin · username admin · password is FAMILYFI_DEFAULT_PASSWORD on the server");
    expect(createLoginTitle({ name: "An adult" })).toBe("Create login for An adult");
    expect(removeLoginConfirm({ username: "adult" }, { name: "An adult" })).toEqual({
      title: "Remove login?",
      message: "adult can no longer sign in to FamilyFi. An adult stays in the household.",
      confirmLabel: "Remove login",
    });
  });
});

describe("gateway load copy", () => {
  const device: GatewayDeviceHealth = {
    id: "device-1",
    name: "Dream Machine",
    model: "UDM Pro",
    state: "ONLINE",
    gateway: true,
    reported: true,
    cpuUtilizationPct: 18.4,
    memoryUtilizationPct: 61.6,
    loadAverage1Min: 0.62,
    loadAverage5Min: 0.5,
    loadAverage15Min: null,
    uptimeSec: 1_209_600 + 7200,
    lastHeartbeatAt: null,
  };

  it("lists a device's load, and shows what the console did not report as unknown, never zero", () => {
    expect(gatewayHealthFacts(device)).toEqual([
      { k: "CPU", v: "18%" },
      { k: "Memory", v: "62%" },
      { k: "Load (1/5/15 min)", v: "0.62 / 0.50 / —" },
      { k: "Uptime", v: "14 d 2 h" },
    ]);
    const blank = gatewayHealthFacts({ ...device, cpuUtilizationPct: null, memoryUtilizationPct: null, loadAverage1Min: null, loadAverage5Min: null, uptimeSec: null });
    expect(blank.map((fact) => fact.v)).toEqual(["—", "—", "—", "—"]);
  });

  it("names uptime at the scale that reads", () => {
    expect(formatUptime(59)).toBe("0 min");
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3 h 5 min");
    expect(formatUptime(null)).toBe("—");
  });

  it("says how many requests FamilyFi sent the console lately", () => {
    expect(requestLoadLine({ windowSec: 300, total: 0, errors: 0, endpoints: [] })).toBe("None in the last 5 min");
    expect(requestLoadLine({ windowSec: 300, total: 62, errors: 1, endpoints: [] })).toBe("62 in the last 5 min · 12.4 a minute · 1 failed");
    expect(requestLoadLine({ windowSec: 300, total: 10, errors: 2, endpoints: [] })).toBe("10 in the last 5 min · 2.0 a minute · 2 failed");
  });
});

describe("settingsTab", () => {
  it("opens the tab the address names", () => {
    expect(settingsTab("household")).toBe("household");
    expect(settingsTab("gateway")).toBe("gateway");
    expect(settingsTab("maintenance")).toBe("maintenance");
    expect(settingsTab(["maintenance", "gateway"])).toBe("maintenance");
  });

  it("opens Household for a missing or unknown tab", () => {
    expect(settingsTab(null)).toBe("household");
    expect(settingsTab(undefined)).toBe("household");
    expect(settingsTab("")).toBe("household");
    expect(settingsTab("Gateway")).toBe("household");
    expect(settingsTab("update")).toBe("household");
  });
});
