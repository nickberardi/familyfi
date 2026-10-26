import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentState, FamilyRole, GroupKind, Prisma } from "@prisma/client";
import { UnifiHttpError } from "@/server/unifi/errors";
import { prisma } from "@/server/db";
import { publicDevice } from "@/server/devices";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { checkupState } from "@/server/checkup";
import { connectionIdentity } from "@/server/unifi/connection";
import {
  ADMIN_POLICY_ID,
  INTERNAL_NETWORK,
  INTERNAL_ZONE,
  IOT_ZONE,
  configureConnectedHousehold,
  createFamilyGroup,
  resetDatabase,
  seedDevice,
} from "../helpers/db";
import { fixtureUnifiClient, policyMacs } from "../helpers/unifi-world";
import type { MacRegistrants } from "@/server/mac-vendor";

// Tests may not contain a vendor-assigned MAC, so a stand-in registry names a private one.
const registrantsOverride = vi.hoisted(() => ({ open: null as null | (() => MacRegistrants) }));
vi.mock("@/server/mac-vendor", async (importActual) => {
  const actual = await importActual<typeof import("@/server/mac-vendor")>();
  return {
    ...actual,
    macRegistrants: (...args: Parameters<typeof actual.macRegistrants>) =>
      registrantsOverride.open ? registrantsOverride.open() : actual.macRegistrants(...args),
  };
});

describe("reconciliation against mocked UniFi", () => {
  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
    vi.restoreAllMocks();
  });

  it("quarantines newly discovered in-scope MACs and never mutates foreign policies", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    expect(await runReconcileOnce()).toBe(true);

    const devices = await prisma().device.findMany({ orderBy: { mac: "asc" } });
    expect(devices.map((row) => row.mac)).toEqual(["02:00:00:00:00:01", "02:00:00:00:00:02", "02:00:00:00:00:03"]);
    expect(devices.every((row) => row.assignment === AssignmentState.quarantined)).toBe(true);

    const appPolicies = await prisma().appPolicy.findMany();
    expect(appPolicies.length).toBeGreaterThan(0);
    expect(client.state.policies.some((policy) => policy.id === ADMIN_POLICY_ID && policy.name === "Allow LAN DNS")).toBe(
      true,
    );
    expect(client.state.policies.some((policy) => policy.id === "66666666-6666-4666-8666-666666666666")).toBe(true);
    expect(client.calls.some((call) => call.method === "PUT" && call.path.includes("ordering"))).toBe(false);
    expect(
      client.calls.some(
        (call) =>
          (call.method === "PUT" || call.method === "DELETE") && call.path.includes(ADMIN_POLICY_ID),
      ),
    ).toBe(false);
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("applied");
  });

  it("records online presence, connection type, and the wireless access point", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();

    const wireless = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(wireless.presenceOnline).toBe(true);
    expect(wireless.presenceCheckedAt).not.toBeNull();
    expect(wireless.connectedAt?.toISOString()).toBe("2026-09-27T23:42:00.000Z");
    expect(wireless.connectionType).toBe("wireless");
    expect(wireless.accessPointName).toBe("Upstairs AP");
    expect(client.calls.filter((call) => call.path.endsWith("/devices"))).toHaveLength(1);

    const wired = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:02" } });
    expect(wired.connectionType).toBe("wired");
    expect(wired.accessPointName).toBeNull();
  });

  it("marks an absent device offline without changing last seen, then records reconnection", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const before = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });

    const removed = client.state.clients.shift()!;
    await runReconcileOnce();
    const offline = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(offline.presenceOnline).toBe(false);
    expect(offline.presenceCheckedAt).not.toBeNull();
    expect(offline.lastSeenAt).toEqual(before.lastSeenAt);
    expect(offline.connectedAt).toBeNull();

    client.state.clients.unshift(removed);
    await runReconcileOnce();
    const reconnected = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(reconnected.presenceOnline).toBe(true);
    expect(reconnected.connectedAt?.toISOString()).toBe("2026-09-27T23:42:00.000Z");
  });

  it("leaves a device that stays offline alone, and records the check on the household", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    client.state.clients.shift();
    await runReconcileOnce();
    const offline = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    const firstSweep = (await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).presenceCheckedAt!;

    await runReconcileOnce();

    const still = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(still.updatedAt).toEqual(offline.updatedAt);
    expect(still.presenceCheckedAt).toEqual(offline.presenceCheckedAt);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.presenceCheckedAt!.getTime()).toBeGreaterThan(firstSweep.getTime());
    const shown = publicDevice(still, undefined, new Date(), household.presenceCheckedAt);
    expect(shown.presence).toBe("offline");
    expect(shown.presenceCheckedAt).toBe(household.presenceCheckedAt!.toISOString());
  });

  it("forgets an unassigned device unseen for a month, never one in a group", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const group = await prisma().group.create({ data: { kind: GroupKind.things, name: "TVs" } });
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const lately = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    await prisma().device.createMany({
      data: [
        { mac: "02:00:00:00:0f:01", assignment: AssignmentState.quarantined, lastSeenAt: longAgo },
        { mac: "02:00:00:00:0f:02", assignment: AssignmentState.quarantined, lastSeenAt: null, createdAt: longAgo },
        { mac: "02:00:00:00:0f:03", assignment: AssignmentState.quarantined, lastSeenAt: lately },
        { mac: "02:00:00:00:0f:04", assignment: AssignmentState.assigned, groupId: group.id, lastSeenAt: longAgo },
      ],
    });
    await runReconcileOnce();
    const left = await prisma().device.findMany({ where: { mac: { startsWith: "02:00:00:00:0f:" } }, orderBy: { mac: "asc" } });
    expect(left.map((device) => device.mac)).toEqual(["02:00:00:00:0f:03", "02:00:00:00:0f:04"]);
  });

  it("preserves the last observation when the client read fails and tolerates an unknown access point", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const before = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });

    client.listClients = async () => { throw new Error("UniFi clients unavailable"); };
    await runReconcileOnce();
    const retained = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(retained.presenceOnline).toBe(true);
    expect(retained.presenceCheckedAt).toEqual(before.presenceCheckedAt);

    client.listClients = async () => [...client.state.clients];
    client.listSiteDevices = async () => { throw new Error("UniFi access points unavailable"); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runReconcileOnce();
    expect(warn).toHaveBeenCalledWith("UniFi access point lookup failed:", expect.objectContaining({ message: "UniFi access points unavailable" }));
    warn.mockRestore();
    const retainedAccessPoint = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(retainedAccessPoint.presenceOnline).toBe(true);
    expect(retainedAccessPoint.accessPointName).toBe("Upstairs AP");

    client.listSiteDevices = async () => [...client.state.siteDevices];
    client.state.siteDevices = [];
    await runReconcileOnce();
    const unnamed = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(unnamed.presenceOnline).toBe(true);
    expect(unnamed.accessPointName).toBeNull();

  });

  it("records the manufacturer at sync and keeps it while the registry is unreadable", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    registrantsOverride.open = () => ({
      forPrefix: () => null,
      forMac: (mac) => (mac === "02:00:00:00:00:01" ? "Example Registrant" : null),
    });
    try {
      await runReconcileOnce();
      expect((await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } })).manufacturer).toBe("Example Registrant");
      expect((await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:02" } })).manufacturer).toBeNull();

      registrantsOverride.open = () => { throw new Error("registry unreadable"); };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await runReconcileOnce();
      expect(warn).toHaveBeenCalledWith("MAC registrant database unavailable:", expect.objectContaining({ message: "registry unreadable" }));
      warn.mockRestore();
      expect((await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } })).manufacturer).toBe("Example Registrant");
    } finally {
      registrantsOverride.open = null;
    }

    // The committed registry never names a locally administered address.
    await runReconcileOnce();
    expect((await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } })).manufacturer).toBeNull();
  });

  it("moves MACs from quarantine to the group's rule policies on assignment", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({
      where: { mac: "02:00:00:00:00:01" },
      data: { groupId: group.id, assignment: AssignmentState.assigned },
    });
    await runReconcileOnce();

    const groupPolicy = client.state.policies.find((policy) => policy.name === "FamilyFi Bedtime");
    expect(policyMacs(groupPolicy ?? {})).toContain("02:00:00:00:00:01");
    const quarantine = client.state.policies.filter((policy) => policy.name.includes("Quarantine"));
    expect(quarantine.some((policy) => policyMacs(policy).includes("02:00:00:00:00:01"))).toBe(false);
  });

  it("rediscovers a deleted assigned device as quarantined and leaves absent devices deleted", async () => {
    const mac = "02:00:00:00:00:01";
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    const assigned = await prisma().device.update({
      where: { mac },
      data: { groupId: group.id, assignment: AssignmentState.assigned },
    });
    await runReconcileOnce();
    expect(client.state.policies.some((policy) => policy.name === "FamilyFi Bedtime" && policyMacs(policy).includes(mac))).toBe(true);

    await prisma().device.delete({ where: { mac } });
    await runReconcileOnce();
    const rediscovered = await prisma().device.findUniqueOrThrow({ where: { mac } });
    expect(rediscovered.id).not.toBe(assigned.id);
    expect(rediscovered.groupId).toBeNull();
    expect(rediscovered.assignment).toBe(AssignmentState.quarantined);
    expect(client.state.policies.some((policy) => policy.name === "FamilyFi Bedtime" && policyMacs(policy).includes(mac))).toBe(false);
    expect(client.state.policies.some((policy) => policy.name.includes("Quarantine") && policyMacs(policy).includes(mac))).toBe(true);
    expect(client.state.policies.find((policy) => policy.id === ADMIN_POLICY_ID)?.name).toBe("Allow LAN DNS");
    expect(client.calls.some((call) => (call.method === "PUT" || call.method === "DELETE") && call.path.includes(ADMIN_POLICY_ID))).toBe(false);

    client.state.clients = client.state.clients.filter((clientRow) => clientRow.macAddress !== mac);
    await prisma().device.delete({ where: { mac } });
    await runReconcileOnce();
    expect(await prisma().device.findUnique({ where: { mac } })).toBeNull();
  });

  it("recreates its own policy when the gateway no longer has it", async () => {
    const mac = "02:00:00:00:00:01";
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({ where: { mac }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
    await runReconcileOnce();
    const recorded = await prisma().rulePolicy.findFirstOrThrow();

    // Someone removes FamilyFi's policy on the console; the rule then changes.
    client.state.policies = client.state.policies.filter((policy) => policy.id !== recorded.unifiPolicyId);
    await prisma().rule.update({ where: { id: recorded.ruleId }, data: { name: "School nights" } });
    expect(await runReconcileOnce()).toBe(true);

    const replacement = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(replacement.unifiPolicyId).not.toBe(recorded.unifiPolicyId);
    expect(replacement.lastError).toBeNull();
    const policy = client.state.policies.find((item) => item.id === replacement.unifiPolicyId);
    expect(policyMacs(policy ?? {})).toContain(mac);
    expect(policy?.name).toBe("FamilyFi School nights");
  });

  it("notices a policy removed on the console even when nothing else changed", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const [recorded] = await prisma().appPolicy.findMany();
    client.state.policies = client.state.policies.filter((policy) => policy.id !== recorded.unifiPolicyId);

    await runReconcileOnce();
    const replacement = await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(replacement.unifiPolicyId).not.toBe(recorded.unifiPolicyId);
    expect(client.state.policies.some((policy) => policy.id === replacement.unifiPolicyId)).toBe(true);
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("applied");
  });

  it("puts back a policy someone changed on the console, and records what they changed", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const [recorded] = await prisma().appPolicy.findMany();
    const onGateway = client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!;
    const macs = [...policyMacs(onGateway)].sort();
    const enabled = onGateway.enabled;
    onGateway.enabled = !enabled;
    onGateway.source.trafficFilter!.macAddressFilter!.macAddresses = macs.slice(1);

    await runReconcileOnce();
    const restored = client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!;
    expect(restored.enabled).toBe(enabled);
    expect([...policyMacs(restored)].sort()).toEqual(macs);
    const row = await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.gatewayDrift).toEqual([
      { field: "switch", familyfi: enabled, gateway: !enabled },
      { field: "devices", familyfi: macs, gateway: macs.slice(1) },
    ]);
    expect(row.driftSeenAt).toBeInstanceOf(Date);
    expect(row.lastError).toBeNull();

    // Put back, so the next pass writes nothing and keeps what it recorded.
    const writes = client.calls.length;
    await runReconcileOnce();
    expect(client.calls.slice(writes).some((call) => call.method === "PUT")).toBe(false);
    expect((await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } })).gatewayDrift).toEqual(row.gatewayDrift);
  });

  it("puts back a rule's window policy someone made always-on, and notes it on Checkup by rule", async () => {
    const mac = "02:00:00:00:00:01";
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({ where: { mac }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
    await runReconcileOnce();
    const recorded = await prisma().rulePolicy.findFirstOrThrow({ include: { rule: true } });
    const onGateway = client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!;
    const schedule = onGateway.schedule;
    expect(schedule).toBeTruthy();
    // A pass that changed nothing on the console leaves the window's policy alone.
    expect((await prisma().rulePolicy.findUniqueOrThrow({ where: { id: recorded.id } })).gatewayDrift).toBeNull();
    onGateway.schedule = null;

    await runReconcileOnce();
    expect(client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!.schedule).toEqual(schedule);
    expect((await prisma().rulePolicy.findUniqueOrThrow({ where: { id: recorded.id } })).gatewayDrift).toEqual([{ field: "schedule", familyfi: "scheduled", gateway: "always" }]);
    const note = (await checkupState()).findings.find((finding) => finding.check === "gateway_drift")!;
    expect(note.id).toBe(`gateway_drift:${recorded.ruleId}`);
    expect(note.details.drift).toMatchObject({ rule: { id: recorded.ruleId, name: recorded.rule.name }, putBack: true });
    expect(note.details.drift).not.toHaveProperty("group");
  });

  it("keeps what the console changed while putting it back fails", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const [recorded] = await prisma().appPolicy.findMany();
    const onGateway = client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!;
    const enabled = onGateway.enabled;
    onGateway.enabled = !enabled;
    vi.spyOn(client, "updatePolicy").mockRejectedValueOnce(new Error("gateway busy"));

    await runReconcileOnce();
    const row = await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.lastError).toBe("gateway busy");
    expect(row.gatewayDrift).toEqual([{ field: "switch", familyfi: enabled, gateway: !enabled }]);

    await runReconcileOnce();
    const repaired = await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(repaired.lastError).toBeNull();
    expect(repaired.gatewayDrift).toEqual(row.gatewayDrift);
    expect(client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!.enabled).toBe(enabled);
  });

  it("forgets what the console changed once FamilyFi changes the policy itself", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const [recorded] = await prisma().appPolicy.findMany();
    const onGateway = client.state.policies.find((policy) => policy.id === recorded.unifiPolicyId)!;
    onGateway.name = "Renamed in UniFi";
    await runReconcileOnce();
    expect((await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } })).gatewayDrift).not.toBeNull();

    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: !household.quarantineEnforced } });
    // Even when FamilyFi's own write fails: what it wants now is no longer what the console changed.
    vi.spyOn(client, "updatePolicy").mockRejectedValueOnce(new Error("gateway busy"));
    await runReconcileOnce();
    const row = await prisma().appPolicy.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(row.lastError).toBe("gateway busy");
    expect(row.gatewayDrift).toBeNull();
    expect(row.driftSeenAt).toBeNull();
  });

  it("clears a stale record whose policy is already gone from the gateway", async () => {
    const mac = "02:00:00:00:00:01";
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({ where: { mac }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
    await runReconcileOnce();
    const groupPolicy = await prisma().rulePolicy.findFirstOrThrow();

    // The policy is deleted on the console, then the group no longer needs one.
    client.state.policies = client.state.policies.filter((policy) => policy.id !== groupPolicy.unifiPolicyId);
    await prisma().device.update({ where: { mac }, data: { groupId: null, assignment: AssignmentState.quarantined } });
    await runReconcileOnce();

    expect(await prisma().rulePolicy.findUnique({ where: { id: groupPolicy.id } })).toBeNull();
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("applied");
  });

  it("removes a policy it created once no record points at it, and nothing else", async () => {
    const mac = "02:00:00:00:00:01";
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({ where: { mac }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
    await runReconcileOnce();
    const groupPolicy = await prisma().rulePolicy.findFirstOrThrow();

    // A delete elsewhere dropped the record but the UniFi delete failed: the policy is orphaned.
    await prisma().rulePolicy.delete({ where: { id: groupPolicy.id } });
    await prisma().device.update({ where: { mac }, data: { groupId: null, assignment: AssignmentState.quarantined } });
    await prisma().group.delete({ where: { id: group.id } });
    await runReconcileOnce();

    expect(client.state.policies.some((policy) => policy.id === groupPolicy.unifiPolicyId)).toBe(false);
    const creation = await prisma().policyOperation.findFirstOrThrow({ where: { unifiPolicyId: groupPolicy.unifiPolicyId } });
    expect(creation.status).toBe("removed");
    expect(client.state.policies.find((policy) => policy.id === ADMIN_POLICY_ID)?.name).toBe("Allow LAN DNS");
    expect(client.state.policies.some((policy) => policy.id === "66666666-6666-4666-8666-666666666666")).toBe(true);
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("applied");
  });

  it("writes nothing for a group with no rules, and quarantines devices when the group is deleted", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const adult = await prisma().group.create({
      data: {
        kind: GroupKind.family,
        name: "Nick",
        familyRole: FamilyRole.adult,
      },
    });
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: adult.id });
    await runReconcileOnce();
    expect(client.state.policies.some((policy) => policy.name.includes("Nick"))).toBe(false);

    await prisma().device.updateMany({
      where: { groupId: adult.id },
      data: { groupId: null, assignment: AssignmentState.quarantined },
    });
    await prisma().group.delete({ where: { id: adult.id } });
    await runReconcileOnce();
    const quarantine = client.state.policies.filter((policy) => policy.name.includes("Quarantine"));
    expect(quarantine.some((policy) => policyMacs(policy).includes("02:00:00:00:00:01"))).toBe(true);
  });

  it("does not ingest MACs first seen on unmanaged networks", async () => {
    await configureConnectedHousehold({ manageAllNetworks: false, managedNetworkIds: [INTERNAL_NETWORK] });
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const macs = (await prisma().device.findMany()).map((row) => row.mac);
    expect(macs).toContain("02:00:00:00:00:01");
    expect(macs).not.toContain("02:00:00:00:00:02");
  });

  it("keeps unresolved-zone owners and expires a timed pause", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const group = await createFamilyGroup();
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: group.id, zoneId: INTERNAL_ZONE });
    await seedDevice({
      mac: "aa:aa:aa:aa:aa:99",
      groupId: group.id,
      zoneId: null,
      networkId: INTERNAL_NETWORK,
    });
    await prisma().rule.create({
      data: {
        name: "Betsy's Internet Pause",
        kind: "internet",
        mode: "always",
        systemGroupId: group.id,
        expiresAt: new Date(Date.now() - 60_000),
        groups: { create: { groupId: group.id } },
      },
    });
    await runReconcileOnce();
    const refreshed = await prisma().rule.findFirstOrThrow({ where: { systemGroupId: group.id } });
    expect([refreshed.enabled, refreshed.expiresAt]).toEqual([false, null]);
    // The pause has ended, so its policy is gone; the bedtime rule's stays enabled.
    expect(client.state.policies.some((item) => item.name.includes("Betsy"))).toBe(false);
    expect(client.state.policies.find((item) => item.name === "FamilyFi Bedtime")?.enabled).toBe(true);
    expect(await prisma().device.findUnique({ where: { mac: "aa:aa:aa:aa:aa:99" } })).toBeTruthy();
  });

  it("records a partial run when one zone create fails", async () => {
    const client = fixtureUnifiClient();
    client.createError = (body) => {
      if (body.source.zoneId === IOT_ZONE) {
        return new UnifiHttpError(500, "POST", "/v1/sites/x/firewall/policies", "zone down");
      }
      return undefined;
    };
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    expect(run?.status).toBe("partial");
    expect(client.state.policies.some((policy) => policy.name.includes("Internal"))).toBe(true);
  });

  it("clears the connection error once a later sweep reaches the gateway", async () => {
    const client = fixtureUnifiClient();
    vi.spyOn(client, "listZones").mockRejectedValueOnce(new Error("gateway unreachable"));
    setReconcileClientForTests(client);
    await runReconcileOnce();
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      connectionStatus: "error",
      connectionError: "gateway unreachable",
    });

    await runReconcileOnce();
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      connectionStatus: "connected",
      connectionError: null,
    });
  });

  it("does not run while another owner holds the lock", async () => {
    await prisma().reconciliationLock.create({
      data: { id: "global", owner: "other", expiresAt: new Date(Date.now() + 60_000) },
    });
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    expect(await runReconcileOnce()).toBe(false);
    expect(await prisma().syncRun.count()).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it("leaves a pending create operation after an interrupted UniFi write", async () => {
    const client = fixtureUnifiClient();
    client.throwAfterCreate = true;
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const ops = await prisma().policyOperation.findMany();
    expect(ops.some((op) => op.status === "pending")).toBe(true);
    expect(client.state.policies.some((policy) => policy.id === ADMIN_POLICY_ID)).toBe(true);
  });

  it("takes over the policy an interrupted create left, so no duplicate stays", async () => {
    const client = fixtureUnifiClient();
    const before = new Set(client.state.policies.map((policy) => policy.id));
    client.throwAfterCreate = true;
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const leftBehind = client.state.policies.filter((policy) => !before.has(policy.id));
    expect(leftBehind.length).toBeGreaterThan(0);
    // The gateway answers in its own key order, lists MACs its own way and fills in defaults.
    client.state.policies = client.state.policies.map((policy) => {
      if (before.has(policy.id)) return policy;
      const reordered = Object.fromEntries(Object.entries(policy).reverse()) as typeof policy;
      const macs = reordered.source.trafficFilter?.macAddressFilter?.macAddresses;
      if (macs) macs.reverse();
      return { ...reordered, connectionStateType: "ALL" } as typeof policy;
    });

    client.throwAfterCreate = false;
    await runReconcileOnce();

    const ids = new Set(client.state.policies.map((policy) => policy.id));
    for (const policy of leftBehind) expect(ids.has(policy.id)).toBe(true);
    const recorded = await prisma().appPolicy.findMany();
    expect(client.state.policies.filter((policy) => !before.has(policy.id)).map((policy) => policy.id).sort()).toEqual(
      recorded.map((policy) => policy.unifiPolicyId).sort(),
    );
    expect(await prisma().policyOperation.count({ where: { status: "pending" } })).toBe(0);
    expect(await prisma().policyOperation.count({ where: { payload: { not: Prisma.DbNull } } })).toBe(0);
    expect(ids.has(ADMIN_POLICY_ID)).toBe(true);
  });

  it("keeps enforcing with the policy an interrupted create left when the gateway refuses the next create", async () => {
    const client = fixtureUnifiClient();
    const before = new Set(client.state.policies.map((policy) => policy.id));
    client.throwAfterCreate = true;
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const leftBehind = client.state.policies.filter((policy) => !before.has(policy.id)).map((policy) => policy.id);
    expect(leftBehind.length).toBeGreaterThan(0);

    client.throwAfterCreate = false;
    client.createError = new UnifiHttpError(400, "POST", "/v1/sites/x/firewall/policies", "refused");
    await runReconcileOnce();

    const ids = client.state.policies.map((policy) => policy.id);
    for (const id of leftBehind) expect(ids).toContain(id);
    const recorded = (await prisma().appPolicy.findMany()).map((policy) => policy.unifiPolicyId);
    expect(recorded.sort()).toEqual([...leftBehind].sort());
  });

  it("never takes a policy for a lost create's unless it carries exactly that payload", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const scope = { connectionIdentity: connectionIdentity(household), siteId: household.unifiSiteId! };
    const admin = client.state.policies.find((policy) => policy.id === ADMIN_POLICY_ID)!;
    // A lost create of the administrator's policy renamed: same everything but the name.
    const pending = await prisma().policyOperation.create({
      data: {
        ...scope,
        intent: "create",
        status: "pending",
        payload: JSON.parse(JSON.stringify({ ...admin, id: undefined, name: `FamilyFi ${admin.name}` })),
      },
    });

    await runReconcileOnce();

    expect(client.state.policies.some((policy) => policy.id === ADMIN_POLICY_ID)).toBe(true);
    expect((await prisma().policyOperation.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("pending");
  });
});
