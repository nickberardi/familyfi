import { describe, expect, it } from "vitest";
import { createLoginTitle, gatewayFacts, householdMemberNote, keyStatusLine, loginFormState, recoveryNote, removeLoginConfirm, usernameFromName } from "@/lib/settings-copy";
import type { UnifiSettings } from "@/lib/types";

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
