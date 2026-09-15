import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HttpUnifiClient, assertNotPolicyOrderingPut } from "@/server/unifi/client";
import { UnifiConfigError } from "@/server/unifi/errors";
import { resolveIntegrationBase } from "@/server/unifi/base-url";
import { collectPages } from "@/server/unifi/paginate";
import { MockUnifiClient, createMockUnifiState } from "@/server/unifi/mock";
import { mapClientsToZones, selectExternalZone } from "@/server/unifi/mapping";
import { orderedPolicyIds, relativeOrderPreserved } from "@/server/unifi/ordering";
import { internetBlockPolicy, spikePolicyName, toPolicyUpdate } from "@/server/unifi/payloads";
import { toUnifiSchedule, unifiPolicyEnabled } from "@/server/unifi/schedule-map";
import { sanitizeUnifiText } from "@/server/unifi/sanitize";
import { applyInternetBlocks, discoverInventory, setPoliciesEnabled, deletePolicies } from "@/server/unifi/spike";
import { planPolicies } from "@/server/unifi/plan";
import { AssignmentState, GroupKind, GroupMode } from "@prisma/client";
import { UNIFI_PAGE_LIMIT } from "@/server/unifi/types";
import type { ClientOverview, FirewallPolicy, FirewallZone, NetworkDetails, UnifiPage } from "@/server/unifi/types";

const fixtures = join(__dirname, "../fixtures/unifi");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8")) as T;
}

describe("resolveIntegrationBase", () => {
  it("records the complete local integration URL", () => {
    expect(resolveIntegrationBase({ baseUrl: "https://192.168.0.1/proxy/network/integration" })).toBe(
      "https://192.168.0.1/proxy/network/integration",
    );
  });

  it("rejects a bare hostname", () => {
    expect(() => resolveIntegrationBase({ baseUrl: "192.168.0.1" })).toThrow(UnifiConfigError);
    expect(() => resolveIntegrationBase({ baseUrl: "https://192.168.0.1" })).toThrow(/integration/);
  });

  it("builds the cloud connector base", () => {
    expect(resolveIntegrationBase({ consoleId: "abc:123" })).toBe(
      "https://api.ui.com/v1/connector/consoles/abc:123/proxy/network/integration",
    );
  });
});

describe("pagination", () => {
  it("walks pages with limit 200", async () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const seen: number[] = [];
    const all = await collectPages(async (offset, limit) => {
      seen.push(limit);
      expect(limit).toBe(UNIFI_PAGE_LIMIT);
      return {
        offset,
        limit,
        count: Math.min(limit, items.length - offset),
        totalCount: items.length,
        data: items.slice(offset, offset + limit),
      };
    });
    expect(all).toHaveLength(250);
    expect(seen.every((limit) => limit <= 200)).toBe(true);
  });

  it("refuses a limit above 200", async () => {
    await expect(collectPages(async () => ({ offset: 0, limit: 201, count: 0, totalCount: 0, data: [] }), 201)).rejects.toThrow(
      /200/,
    );
  });
});

describe("payloads", () => {
  it("matches the sanitized create-policy fixture", () => {
    const expected = readJson<ReturnType<typeof internetBlockPolicy>>("create-policy.request.json");
    const actual = internetBlockPolicy({
      name: spikePolicyName("Internal"),
      sourceZoneId: "33333333-3333-4333-8333-333333333333",
      destinationZoneId: "33333333-3333-4333-8333-333333333335",
      macAddresses: ["02:00:00:00:00:01", "02-00-00-00-00-03"],
      action: "BLOCK",
    });
    expect(actual).toEqual(expected);
  });

  it("PUT payload keeps required fields and can toggle enabled", () => {
    const policy = readJson<UnifiPage<FirewallPolicy>>("policies.page.json").data[0]!;
    const update = toPolicyUpdate(policy, { enabled: false });
    expect(update.enabled).toBe(false);
    expect(update.name).toBe(policy.name);
    expect(update).not.toHaveProperty("id");
    expect(update).not.toHaveProperty("metadata");
  });
});

describe("UniFi schedule mapping", () => {
  it("emits EVERY_WEEK for school nights including overnight times", () => {
    expect(
      toUnifiSchedule({ enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }),
    ).toEqual({
      mode: "EVERY_WEEK",
      repeatOnDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
      timeFilter: { startTime: "21:30", stopTime: "06:45" },
    });
  });

  it("omits schedule when the group has none", () => {
    expect(toUnifiSchedule({ enabled: false, days: [], start: "21:00", end: "07:00" })).toBeUndefined();
  });

  it("pauses with enabled false and leaves quarantine on unless overridden", () => {
    const now = new Date("2026-09-14T18:00:00Z");
    expect(
      unifiPolicyEnabled({
        ownerScope: "group",
        protected: false,
        suspension: { active: true, until: null },
        now,
      }),
    ).toBe(false);
    expect(
      unifiPolicyEnabled({
        ownerScope: "quarantine",
        protected: false,
        suspension: { active: true, until: null },
        now,
      }),
    ).toBe(true);
    expect(
      unifiPolicyEnabled({
        ownerScope: "quarantine",
        protected: false,
        suspension: { active: false, until: null },
        now,
        quarantineEnforced: false,
      }),
    ).toBe(false);
  });
});

describe("mapping", () => {
  it("maps clients via IPv4 subnet and zone.networkIds, not a client networkId field", () => {
    const networks = readJson<UnifiPage<NetworkDetails>>("networks.page.json").data;
    const zones = readJson<UnifiPage<FirewallZone>>("zones.page.json").data;
    const clients = readJson<UnifiPage<ClientOverview>>("clients.page.json").data;
    const mappings = mapClientsToZones({ clients, networks, zones });
    expect(clients.every((client) => !("networkId" in client))).toBe(true);
    expect(mappings[0]?.sourceZoneId).toBe("33333333-3333-4333-8333-333333333333");
    expect(mappings[0]?.method).toBe("ipv4-subnet");
    expect(mappings[1]?.sourceZoneId).toBe("33333333-3333-4333-8333-333333333334");
    expect(selectExternalZone(zones)?.name).toBe("External");
  });
});

describe("ordering", () => {
  it("treats new ids as insertions that must not scramble prior ids", () => {
    const before = ["a", "b", "c"];
    expect(relativeOrderPreserved(before, ["a", "spike", "b", "c"])).toBe(true);
    expect(relativeOrderPreserved(before, ["a", "c", "b"])).toBe(false);
  });
});

describe("sanitize", () => {
  it("replaces MACs and documentation IPs", () => {
    expect(sanitizeUnifiText("host 8c:85:90:1a:44:0e at 203.0.113.9")).toMatch(/02:00:00:00:00:01/);
    expect(sanitizeUnifiText("host 8c:85:90:1a:44:0e at 203.0.113.9")).toMatch(/192\.0\.2\./);
  });
});

describe("HttpUnifiClient", () => {
  it("sends X-API-KEY, paginates, and refuses ordering PUT", async () => {
    const headers: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      headers.push(String((init?.headers as Record<string, string>)["X-API-KEY"]));
      if (url.includes("/v1/sites?") || url.endsWith("/v1/sites")) {
        const parsed = new URL(url);
        const offset = Number(parsed.searchParams.get("offset") ?? 0);
        const limit = Number(parsed.searchParams.get("limit") ?? 25);
        expect(limit).toBeLessThanOrEqual(200);
        const data = offset === 0 ? [{ id: "s1", name: "redacted", internalReference: "default" }] : [];
        return new Response(JSON.stringify({ count: data.length, data, limit, offset, totalCount: 1 }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };
    const client = new HttpUnifiClient({
      apiKey: "secret-key",
      baseUrl: "https://192.168.0.1/proxy/network/integration",
      fetchImpl,
    });
    expect(await client.listSites()).toEqual([{ id: "s1", name: "redacted", internalReference: "default" }]);
    expect(headers[0]).toBe("secret-key");
    expect(() => assertNotPolicyOrderingPut("PUT", "/v1/sites/x/firewall/policies/ordering")).toThrow(/never reorders/);
    expect(() => assertNotPolicyOrderingPut("GET", "/v1/sites/x/firewall/policies/ordering")).not.toThrow();
  });
});

describe("mocked spike flow", () => {
  it("creates BLOCK MAC policies, disables via PUT, deletes, and never calls ordering PUT", async () => {
    const adminId = "55555555-5555-4555-8555-555555555555";
    const state = createMockUnifiState({
      version: "9.5.0",
      sites: readJson<UnifiPage<{ id: string; name: string; internalReference: string }>>("sites.page.json").data,
      networks: readJson<UnifiPage<NetworkDetails>>("networks.page.json").data,
      zones: readJson<UnifiPage<FirewallZone>>("zones.page.json").data,
      clients: readJson<UnifiPage<ClientOverview>>("clients.page.json").data,
      policies: readJson<UnifiPage<FirewallPolicy>>("policies.page.json").data,
      ordering: { beforeSystemDefined: [], afterSystemDefined: [adminId] },
    });
    const client = new MockUnifiClient(state);
    const inventory = await discoverInventory(client);
    expect(inventory.applicationVersion).toBe("9.5.0");
    const applied = await applyInternetBlocks(
      client,
      inventory,
      ["02:00:00:00:00:01", "02:00:00:00:00:02"],
      "local",
    );
    expect(applied.created).toHaveLength(2);
    expect(applied.created.every((policy) => policy.action.type === "BLOCK")).toBe(true);
    expect(applied.adminOrderPreserved).toBe(true);
    expect(orderedPolicyIds(applied.orderingAfter)[0]).toBe(adminId);

    const disabled = await setPoliciesEnabled(client, inventory.site.id, applied.created, false);
    expect(disabled.every((policy) => policy.enabled === false)).toBe(true);

    const cleanup = await deletePolicies(
      client,
      inventory.site.id,
      applied.created.map((policy) => policy.id),
    );
    expect(cleanup.failed).toHaveLength(0);
    const finalOrder = await client.getPolicyOrdering(inventory.site.id);
    expect(finalOrder.afterSystemDefined).toEqual([adminId]);
    expect(client.calls.some((call) => call.method === "PUT" && call.path.includes("ordering"))).toBe(false);
  });
});

describe("planPolicies", () => {
  const destinationZoneId = "ext";
  const now = new Date("2026-09-14T16:00:00Z");
  const child = {
    id: "kid",
    name: "Betsy",
    kind: GroupKind.family,
    protected: false,
    mode: GroupMode.scheduled,
    scheduleEnabled: true,
    scheduleDays: [1, 2, 3, 4, 5],
    scheduleStart: "21:00",
    scheduleEnd: "07:00",
    suspensionActive: false,
    suspensionUntil: null as Date | null,
  };

  it("emits one always-on quarantine policy per source zone", () => {
    const { policies } = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      zoneNames: { z1: "Internal", z2: "IoT" },
      groups: [child],
      devices: [
        { mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.quarantined, groupId: null, zoneId: "z1" },
        { mac: "aa:aa:aa:aa:aa:02", assignment: AssignmentState.quarantined, groupId: null, zoneId: "z2" },
        { mac: "aa:aa:aa:aa:aa:03", assignment: AssignmentState.quarantined, groupId: null, zoneId: "z1" },
      ],
    });
    expect(policies).toHaveLength(2);
    expect(policies.every((policy) => policy.ownerScope === "quarantine" && policy.enabled && !policy.schedule)).toBe(true);
    expect(policies.find((policy) => policy.zoneId === "z1")?.macAddresses).toEqual(["aa:aa:aa:aa:aa:01", "aa:aa:aa:aa:aa:03"]);
    expect(policies.every((policy) => policy.destinationZoneId === destinationZoneId)).toBe(true);
    expect(policies.find((policy) => policy.zoneId === "z1")?.name).toBe("FamilyFi Quarantine Internal Devices");
    expect(policies.find((policy) => policy.zoneId === "z2")?.name).toBe("FamilyFi Quarantine IoT Devices");
  });

  it("disables quarantine policies when enforcement is off", () => {
    const { policies } = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      zoneNames: { z1: "Internal" },
      groups: [child],
      quarantineEnforced: false,
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.quarantined, groupId: null, zoneId: "z1" }],
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.ownerScope).toBe("quarantine");
    expect(policies[0]?.enabled).toBe(false);
  });

  it("skips protected groups and keeps bedtime schedule while Pause sets enabled false", () => {
    const { policies } = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      zoneNames: { z1: "Internal" },
      groups: [
        child,
        { ...child, id: "adult", protected: true },
      ],
      devices: [
        { mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1" },
        { mac: "aa:aa:aa:aa:aa:99", assignment: AssignmentState.assigned, groupId: "adult", zoneId: "z1" },
      ],
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.enabled).toBe(true);
    expect(policies[0]?.name).toBe("FamilyFi Betsy's Internet Access");
    expect(policies[0]?.schedule?.mode).toBe("EVERY_WEEK");

    const paused = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      groups: [{ ...child, suspensionActive: true, suspensionUntil: new Date("2026-09-14T18:00:00Z") }],
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1" }],
    });
    expect(paused.policies[0]?.enabled).toBe(false);
    expect(paused.policies[0]?.schedule?.mode).toBe("EVERY_WEEK");
  });

  it("Always mode omits UniFi schedule and Pause keeps schedule null", () => {
    const always = { ...child, mode: GroupMode.always, scheduleEnabled: false };
    const { policies } = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      zoneNames: { z1: "Internal" },
      groups: [always],
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1" }],
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.enabled).toBe(true);
    expect(policies[0]?.schedule).toBeUndefined();

    const paused = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      groups: [{ ...always, suspensionActive: true, suspensionUntil: null }],
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1" }],
    });
    expect(paused.policies[0]?.enabled).toBe(false);
    expect(paused.policies[0]?.schedule).toBeUndefined();
  });

  it("does not drop existing owners when a MAC has no zone", () => {
    const planned = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      groups: [child],
      devices: [
        { mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: null },
        { mac: "aa:aa:aa:aa:aa:02", assignment: AssignmentState.assigned, groupId: "kid", zoneId: "z1" },
      ],
    });
    expect(planned.retainOwners.has("group:kid")).toBe(true);
    expect(planned.policies[0]?.macAddresses).toEqual(["aa:aa:aa:aa:aa:02"]);

    const unresolvedOnly = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      groups: [child],
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "kid", zoneId: null }],
    });
    expect(unresolvedOnly.policies).toHaveLength(0);
    expect(unresolvedOnly.retainOwners.has("group:kid")).toBe(true);
  });

  it("does not retain block policies for protected groups even if a MAC is unresolved", () => {
    const planned = planPolicies({
      installId: "default",
      now,
      destinationZoneId,
      groups: [{ ...child, id: "adult", protected: true }],
      devices: [{ mac: "aa:aa:aa:aa:aa:01", assignment: AssignmentState.assigned, groupId: "adult", zoneId: null }],
    });
    expect(planned.policies).toHaveLength(0);
    expect(planned.retainOwners.size).toBe(0);
  });
});
