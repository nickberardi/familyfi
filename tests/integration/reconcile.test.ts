import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, FamilyRole, GroupKind } from "@prisma/client";
import { UnifiHttpError } from "@/server/unifi/errors";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
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

describe("reconciliation against mocked UniFi", () => {
  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
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

  it("moves MACs from quarantine to a group policy on assignment", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    await runReconcileOnce();
    const group = await createFamilyGroup();
    await prisma().device.update({
      where: { mac: "02:00:00:00:00:01" },
      data: { groupId: group.id, assignment: AssignmentState.assigned },
    });
    await runReconcileOnce();

    const groupPolicy = client.state.policies.find((policy) => policy.name.includes("Betsy"));
    expect(policyMacs(groupPolicy ?? {})).toContain("02:00:00:00:00:01");
    const quarantine = client.state.policies.filter((policy) => policy.name.includes("Quarantine"));
    expect(quarantine.some((policy) => policyMacs(policy).includes("02:00:00:00:00:01"))).toBe(false);
  });

  it("skips protected groups and quarantines devices when the group is deleted", async () => {
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    const adult = await prisma().group.create({
      data: {
        kind: GroupKind.family,
        name: "Nick",
        familyRole: FamilyRole.adult,
        protected: true,
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
    await prisma().group.update({
      where: { id: group.id },
      data: { suspensionActive: true, suspensionUntil: new Date(Date.now() - 60_000) },
    });
    await runReconcileOnce();
    const refreshed = await prisma().group.findUniqueOrThrow({ where: { id: group.id } });
    expect(refreshed.suspensionActive).toBe(false);
    const policy = client.state.policies.find((item) => item.name.includes("Betsy"));
    expect(policy?.enabled).toBe(true);
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
});
