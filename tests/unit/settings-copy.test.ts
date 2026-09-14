import { describe, expect, it } from "vitest";
import { gatewayFacts, householdMemberNote, usernameFromName } from "@/lib/settings-copy";
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
  });

  it("suggests a personal username from a given name", () => {
    expect(usernameFromName("Melinda")).toBe("melinda");
  });
});
