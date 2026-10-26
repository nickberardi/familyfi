/**
 * Named reconciler scenarios for the paths the other suites do not reach: a gateway that
 * refuses a write, a policy that vanishes mid-pass, a rule whose policy must be kept or
 * dropped, and the background queue. Each one checks what the gateway and the records
 * hold afterwards, because a wrong pause, bedtime or quarantine state hides in exactly
 * these branches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentState, ChangeStatus, FamilyRole, GroupKind, RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  requestReconcile,
  runReconcileOnce,
  setAutoReconcileForTests,
  setReconcileClientForTests,
  setReconcileLockForTests,
  startReconciliation,
} from "@/server/reconciliation";
import { UnifiHttpError } from "@/server/unifi/errors";
import type { MockUnifiClient } from "@/server/unifi/mock";
import {
  ADMIN_POLICY_ID,
  INTERNAL_NETWORK,
  IOT_NETWORK,
  configureConnectedHousehold,
  createFamilyGroup,
  resetDatabase,
  seedDevice,
} from "../helpers/db";
import { fixtureUnifiClient, policyMacs } from "../helpers/unifi-world";

const MAC = "02:00:00:00:00:01";

function gatewayError(status: number, method: string) {
  return new UnifiHttpError(status, method, "/v1/sites/x/firewall/policies/y", `gateway said ${status}`);
}

/** The gateway refuses to delete this one policy until the returned spy is restored. */
function refuseDelete(client: MockUnifiClient, policyId: string | null) {
  const real = client.deletePolicy.bind(client);
  return vi.spyOn(client, "deletePolicy").mockImplementation(async (siteId, id) => {
    if (id === policyId) throw gatewayError(500, "DELETE");
    return real(siteId, id);
  });
}

async function lastRun() {
  return prisma().syncRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
}

/** A group's own pause: its hidden always-on block rule, enabled. */
async function pauseGroup(groupId: string) {
  return prisma().rule.create({
    data: {
      name: "Betsy's Internet Pause",
      kind: RuleKind.internet,
      mode: RuleMode.always,
      systemGroupId: groupId,
      groups: { create: [{ groupId }] },
    },
  });
}

/** A connected household whose first device belongs to a paused group, with its live pause policy: the group's built-in rule. */
async function groupWithPolicy(client: MockUnifiClient) {
  setReconcileClientForTests(client);
  await runReconcileOnce();
  const group = await createFamilyGroup();
  const block = await pauseGroup(group.id);
  await prisma().device.update({ where: { mac: MAC }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
  await runReconcileOnce();
  const policy = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: block.id } });
  return { group, block, policy };
}

/** As `groupWithPolicy`, plus an app-category rule on the group and its live UniFi policy. */
async function groupWithRule(client: MockUnifiClient) {
  const { group } = await groupWithPolicy(client);
  const rule = await prisma().rule.create({
    data: { name: "Video", kind: RuleKind.category, groups: { create: [{ groupId: group.id }] }, targetIds: [4] },
  });
  await runReconcileOnce();
  const rulePolicy = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
  return { group, rule, rulePolicy };
}

describe("reconciler paths", () => {
  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
    setAutoReconcileForTests(false);
    setReconcileLockForTests(undefined);
    vi.restoreAllMocks();
  });

  describe("the pass as a whole", () => {
    it("does nothing while the household has no UniFi connection", async () => {
      await prisma().household.update({ where: { id: "default" }, data: { connectionStatus: "unconfigured" } });
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);

      expect(await runReconcileOnce()).toBe(true);
      expect(await prisma().syncRun.count()).toBe(0);
      expect(client.calls).toHaveLength(0);
    });

    it("fails the run and every pending change, and marks the connection errored, when the gateway has no WAN zone", async () => {
      const client = fixtureUnifiClient();
      client.state.zones = client.state.zones.filter((zone) => zone.name.toLowerCase() !== "external");
      setReconcileClientForTests(client);
      const change = await prisma().changeResult.create({ data: { requestedRevision: 1, scope: "group" } });

      expect(await runReconcileOnce()).toBe(true);

      const run = await lastRun();
      expect(run.status).toBe(ChangeStatus.failed);
      expect(run.error).toMatch(/External\/WAN/);
      const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
      expect(household.connectionStatus).toBe("error");
      expect(household.connectionError).toBe(run.error);
      const failed = await prisma().changeResult.findUniqueOrThrow({ where: { id: change.id } });
      expect(failed.status).toBe(ChangeStatus.failed);
      expect(failed.syncRunId).toBe(run.id);
      expect(client.calls.some((call) => call.method !== "GET")).toBe(false);
    });

    it("skips a client the gateway lists without a MAC address", async () => {
      const client = fixtureUnifiClient();
      const [first, ...rest] = client.state.clients;
      client.state.clients = [{ ...first!, macAddress: undefined as unknown as string }, ...rest];
      setReconcileClientForTests(client);

      await runReconcileOnce();

      const macs = (await prisma().device.findMany()).map((row) => row.mac);
      expect(macs).not.toContain(MAC);
      expect(macs).toHaveLength(rest.length);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("drops sync runs older than a week and keeps the changes they settled", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      const day = 24 * 60 * 60 * 1000;
      const old = await prisma().syncRun.create({
        data: { requestedRevision: 1, status: ChangeStatus.applied, startedAt: new Date(Date.now() - 8 * day) },
      });
      const recent = await prisma().syncRun.create({
        data: { requestedRevision: 1, status: ChangeStatus.applied, startedAt: new Date(Date.now() - 6 * day) },
      });
      const change = await prisma().changeResult.create({
        data: { requestedRevision: 1, scope: "group", status: ChangeStatus.applied, syncRunId: old.id },
      });

      await runReconcileOnce();

      const runs = (await prisma().syncRun.findMany()).map((run) => run.id);
      expect(runs).not.toContain(old.id);
      expect(runs).toContain(recent.id);
      expect(runs).toHaveLength(2);
      const kept = await prisma().changeResult.findUniqueOrThrow({ where: { id: change.id } });
      expect(kept.status).toBe(ChangeStatus.applied);
      expect(kept.syncRunId).toBeNull();
    });

    it("rewrites only the devices whose details changed, and marks every listed one seen", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      await runReconcileOnce();
      const before = await prisma().device.findUniqueOrThrow({ where: { mac: MAC } });
      const first = client.state.clients.find((row) => row.macAddress === MAC)!;
      client.state.clients = client.state.clients.map((row) =>
        row.macAddress === MAC ? { ...row, name: "Renamed tablet" } : row,
      );
      const updateMany = vi.spyOn(prisma().device, "updateMany");
      const upsert = vi.spyOn(prisma().device, "upsert");

      await runReconcileOnce();

      expect(upsert).not.toHaveBeenCalled();
      const perDevice = updateMany.mock.calls.filter(([args]) => typeof args?.where?.mac === "string");
      expect(perDevice).toEqual([[{ where: { mac: MAC }, data: { hostname: "Renamed tablet" } }]]);
      const after = await prisma().device.findUniqueOrThrow({ where: { mac: MAC } });
      expect(after.hostname).toBe("Renamed tablet");
      expect(after.ip).toBe(first.ipAddress ?? before.ip);
      expect(after.lastSeenAt!.getTime()).toBeGreaterThan(before.lastSeenAt!.getTime());
      expect(after.presenceOnline).toBe(true);
    });

    it("carries on when a device is deleted while the pass reads it", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      await runReconcileOnce();
      client.state.clients = client.state.clients.map((row) => (row.macAddress === MAC ? { ...row, name: "Renamed" } : row));
      const findMany = prisma().device.findMany.bind(prisma().device);
      vi.spyOn(prisma().device, "findMany").mockImplementationOnce((async (args: Parameters<typeof findMany>[0]) => {
        const rows = await findMany(args);
        await prisma().device.delete({ where: { mac: MAC } });
        return rows;
      }) as unknown as typeof findMany);

      await runReconcileOnce();

      expect((await lastRun()).status).not.toBe(ChangeStatus.failed);
      const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
      expect(household.connectionStatus).not.toBe("error");
    });

    it("reports a partial run when a group's only device has no firewall zone", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      const group = await createFamilyGroup();
      // Not a client the gateway lists, so nothing fills its zone in.
      await seedDevice({ mac: "02:00:00:00:0a:01", groupId: group.id, zoneId: null });

      await runReconcileOnce();

      const run = await lastRun();
      expect(run.status).toBe(ChangeStatus.partial);
      expect(run.error).toMatch(/no firewall zone/);
      expect(client.state.policies.some((policy) => policy.name.includes("Betsy"))).toBe(false);
    });
  });

  describe("pause policies", () => {
    it("records a refused update on the policy, reports a partial run, and retries it next pass", async () => {
      const client = fixtureUnifiClient();
      const { block, policy } = await groupWithPolicy(client);
      const onGateway = () => client.state.policies.find((item) => item.id === policy.unifiPolicyId);
      expect(onGateway()?.name).toBe("FamilyFi Betsy's Internet Pause");

      await prisma().rule.update({ where: { id: block.id }, data: { name: "Betsy B's Internet Pause" } });
      vi.spyOn(client, "updatePolicy").mockRejectedValueOnce(gatewayError(500, "PUT"));
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(failed.lastError).toMatch(/500/);
      expect(failed.unifiPolicyId).toBe(policy.unifiPolicyId);
      expect(onGateway()?.name).toBe("FamilyFi Betsy's Internet Pause");

      // Same desired state as the failed pass: the recorded error alone makes it write again.
      await runReconcileOnce();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const retried = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(retried.lastError).toBeNull();
      expect(retried.unifiPolicyId).toBe(policy.unifiPolicyId);
      expect(onGateway()?.name).toBe("FamilyFi Betsy B's Internet Pause");
    });

    it("creates the policy again when it disappears between the listing and the update", async () => {
      const client = fixtureUnifiClient();
      const { block, policy } = await groupWithPolicy(client);

      await prisma().rule.update({ where: { id: block.id }, data: { name: "Betsy B's Internet Pause" } });
      vi.spyOn(client, "getPolicy").mockRejectedValueOnce(gatewayError(404, "GET"));
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const replaced = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(replaced.unifiPolicyId).not.toBe(policy.unifiPolicyId);
      const created = client.state.policies.find((item) => item.id === replaced.unifiPolicyId);
      expect(policyMacs(created ?? {})).toContain(MAC);
      expect(created?.name).toBe("FamilyFi Betsy B's Internet Pause");
    });

    it("drops a record whose create failed once the group no longer needs a policy", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      await runReconcileOnce();
      // Paused, with no rules: the pause policy is the only one it needs.
      const group = await prisma().group.create({
        data: { kind: GroupKind.family, name: "Betsy", familyRole: FamilyRole.child },
      });
      const block = await pauseGroup(group.id);
      await prisma().device.update({ where: { mac: MAC }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
      client.createError = (body) => (body.name.includes("Betsy") ? gatewayError(500, "POST") : undefined);
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: block.id } });
      expect(failed.unifiPolicyId).toBeNull();
      expect(failed.lastError).toMatch(/500/);

      client.createError = undefined;
      await prisma().device.update({ where: { mac: MAC }, data: { groupId: null, assignment: AssignmentState.quarantined } });
      await runReconcileOnce();

      expect(await prisma().rulePolicy.findUnique({ where: { id: failed.id } })).toBeNull();
      expect(client.calls.some((call) => call.method === "DELETE")).toBe(false);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("keeps the record and reports a partial run when the gateway refuses a delete", async () => {
      const client = fixtureUnifiClient();
      const { block, policy } = await groupWithPolicy(client);

      await prisma().rule.update({ where: { id: block.id }, data: { enabled: false } });
      const refusal = refuseDelete(client, policy.unifiPolicyId);
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const kept = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(kept.lastError).toMatch(/500/);
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(true);

      refusal.mockRestore();
      await runReconcileOnce();
      expect(await prisma().rulePolicy.findUnique({ where: { id: policy.id } })).toBeNull();
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(false);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("counts a policy the gateway answers 404 for on delete as already deleted", async () => {
      const client = fixtureUnifiClient();
      const { block, policy } = await groupWithPolicy(client);

      // Listed at the start of the pass, then removed on the console before the delete.
      await prisma().rule.update({ where: { id: block.id }, data: { enabled: false } });
      vi.spyOn(client, "deletePolicy").mockRejectedValueOnce(gatewayError(404, "DELETE"));
      await runReconcileOnce();

      expect(await prisma().rulePolicy.findUnique({ where: { id: policy.id } })).toBeNull();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("keeps a group's policy while its devices sit on a network FamilyFi no longer manages", async () => {
      const client = fixtureUnifiClient();
      const { policy } = await groupWithPolicy(client);

      await configureConnectedHousehold({ manageAllNetworks: false, managedNetworkIds: [IOT_NETWORK] });
      await runReconcileOnce();

      expect(await prisma().rulePolicy.findUnique({ where: { id: policy.id } })).not.toBeNull();
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(true);
      expect(client.calls.some((call) => call.method === "DELETE" && call.path.endsWith(policy.unifiPolicyId!))).toBe(false);
    });
  });

  describe("quarantine policies", () => {
    /** A discovered household with quarantine on: every unassigned device sits behind an enabled quarantine policy. */
    async function quarantined(client: MockUnifiClient) {
      await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
      setReconcileClientForTests(client);
      await runReconcileOnce();
      const policy = await prisma().appPolicy.findFirstOrThrow({ where: { ownerScope: "quarantine" }, orderBy: { id: "asc" } });
      return { policy, onGateway: () => client.state.policies.find((item) => item.id === policy.unifiPolicyId) };
    }

    it("records a refused update on the policy, reports a partial run, and retries it next pass", async () => {
      const client = fixtureUnifiClient();
      const { policy, onGateway } = await quarantined(client);
      expect(onGateway()?.enabled).toBe(true);

      await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: false } });
      // The household has a quarantine policy per zone, written in no fixed order: refuse this one's.
      const update = client.updatePolicy.bind(client);
      let refused = false;
      vi.spyOn(client, "updatePolicy").mockImplementation(async (siteId, id, body) => {
        if (id === policy.unifiPolicyId && !refused) {
          refused = true;
          throw gatewayError(500, "PUT");
        }
        return update(siteId, id, body);
      });
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().appPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(failed.lastError).toMatch(/500/);
      expect(onGateway()?.enabled).toBe(true);

      await runReconcileOnce();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const retried = await prisma().appPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(retried.lastError).toBeNull();
      expect(onGateway()?.enabled).toBe(false);
    });

    it("creates the policy again when it disappears between the listing and the update", async () => {
      const client = fixtureUnifiClient();
      const { policy } = await quarantined(client);

      await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: false } });
      const get = client.getPolicy.bind(client);
      let vanished = false;
      vi.spyOn(client, "getPolicy").mockImplementation(async (siteId, id) => {
        if (id === policy.unifiPolicyId && !vanished) {
          vanished = true;
          throw gatewayError(404, "GET");
        }
        return get(siteId, id);
      });
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const replaced = await prisma().appPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(replaced.unifiPolicyId).not.toBe(policy.unifiPolicyId);
      expect(client.state.policies.find((item) => item.id === replaced.unifiPolicyId)?.enabled).toBe(false);
    });

    it("records a failed create, then creates the policy on the next pass", async () => {
      const client = fixtureUnifiClient();
      client.createError = gatewayError(500, "POST");
      setReconcileClientForTests(client);
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().appPolicy.findFirstOrThrow({ where: { ownerScope: "quarantine" } });
      expect(failed.unifiPolicyId).toBeNull();
      expect(failed.lastError).toMatch(/500/);

      client.createError = undefined;
      await runReconcileOnce();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const created = await prisma().appPolicy.findUniqueOrThrow({ where: { id: failed.id } });
      expect(client.state.policies.some((item) => item.id === created.unifiPolicyId)).toBe(true);
    });

    it("marks each refused create failed, so a policy the gateway keeps refusing leaves no open operation", async () => {
      const client = fixtureUnifiClient();
      client.createError = gatewayError(400, "POST");
      setReconcileClientForTests(client);
      await runReconcileOnce();
      await runReconcileOnce();

      const operations = await prisma().policyOperation.findMany();
      expect(operations.length).toBeGreaterThan(0);
      expect(operations.every((operation) => operation.status === "failed")).toBe(true);
    });

    it("keeps a create pending when a proxy answers 5xx, since the gateway may have made it", async () => {
      const client = fixtureUnifiClient();
      client.createError = gatewayError(502, "POST");
      setReconcileClientForTests(client);
      await runReconcileOnce();

      const operations = await prisma().policyOperation.findMany();
      expect(operations.length).toBeGreaterThan(0);
      expect(operations.every((operation) => operation.status === "pending")).toBe(true);
    });

    it("drops policy-write history older than a week, but never an applied creation or a pending one", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      await runReconcileOnce();
      const { policy } = await quarantined(client);
      const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const scope = { connectionIdentity: policy.connectionIdentity, siteId: policy.siteId, intent: "create" as const };
      const stale = await Promise.all(
        ["failed", "removed"].map((status) => prisma().policyOperation.create({ data: { ...scope, status } })),
      );
      const unmatched = await prisma().policyOperation.create({ data: { ...scope, status: "pending", payloadFingerprint: "nothing" } });
      const recent = await prisma().policyOperation.create({ data: { ...scope, status: "failed" } });
      await prisma().$executeRaw`UPDATE "PolicyOperation" SET "updatedAt" = ${old}, "createdAt" = ${old}`;
      await prisma().policyOperation.update({ where: { id: recent.id }, data: { status: "failed" } });

      await runReconcileOnce();

      const left = await prisma().policyOperation.findMany();
      for (const row of stale) expect(left.some((operation) => operation.id === row.id)).toBe(false);
      // A week-old create that found no policy made nothing; it is kept as failed for another week.
      expect(left.find((operation) => operation.id === unmatched.id)?.status).toBe("failed");
      expect(left.some((operation) => operation.id === recent.id)).toBe(true);
      const applied = left.filter((operation) => operation.status === "applied");
      expect(applied.some((operation) => operation.unifiPolicyId === policy.unifiPolicyId)).toBe(true);
    });

    it("drops a record whose create failed once no device needs quarantining", async () => {
      const client = fixtureUnifiClient();
      client.createError = gatewayError(500, "POST");
      setReconcileClientForTests(client);
      await runReconcileOnce();
      const failed = await prisma().appPolicy.findFirstOrThrow({ where: { ownerScope: "quarantine" } });
      expect(failed.unifiPolicyId).toBeNull();

      client.createError = undefined;
      const group = await createFamilyGroup();
      await prisma().device.updateMany({ data: { groupId: group.id, assignment: AssignmentState.assigned } });
      await runReconcileOnce();

      expect(await prisma().appPolicy.count({ where: { ownerScope: "quarantine" } })).toBe(0);
      expect(client.calls.some((call) => call.method === "DELETE")).toBe(false);
    });

    it("keeps the record and reports a partial run when the gateway refuses a delete, and removes it next pass", async () => {
      const client = fixtureUnifiClient();
      const { policy } = await quarantined(client);
      const group = await createFamilyGroup();
      await prisma().device.updateMany({ data: { groupId: group.id, assignment: AssignmentState.assigned } });

      const refusal = refuseDelete(client, policy.unifiPolicyId);
      await runReconcileOnce();
      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const kept = await prisma().appPolicy.findUniqueOrThrow({ where: { id: policy.id } });
      expect(kept.lastError).toMatch(/500/);
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(true);

      refusal.mockRestore();
      await runReconcileOnce();
      expect(await prisma().appPolicy.findUnique({ where: { id: policy.id } })).toBeNull();
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(false);
    });

    it("counts a policy the gateway answers 404 for on delete as already deleted", async () => {
      const client = fixtureUnifiClient();
      const { policy } = await quarantined(client);
      const group = await createFamilyGroup();
      await prisma().device.updateMany({ data: { groupId: group.id, assignment: AssignmentState.assigned } });

      vi.spyOn(client, "deletePolicy").mockRejectedValueOnce(gatewayError(404, "DELETE"));
      await runReconcileOnce();

      expect(await prisma().appPolicy.findUnique({ where: { id: policy.id } })).toBeNull();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("keeps a quarantine policy while its devices have no zone", async () => {
      const client = fixtureUnifiClient();
      const { policy } = await quarantined(client);
      await prisma().device.updateMany({ where: { zoneId: policy.zoneId }, data: { zoneId: null } });
      await runReconcileOnce();
      expect(await prisma().appPolicy.findUnique({ where: { id: policy.id } })).not.toBeNull();
    });
  });

  describe("app and category rule policies", () => {
    it("writes nothing for a rule whose policy is unchanged and still on the gateway", async () => {
      const client = fixtureUnifiClient();
      const { rulePolicy } = await groupWithRule(client);
      const writes = client.calls.length;

      await runReconcileOnce();

      const since = client.calls.slice(writes);
      expect(since.some((call) => call.method !== "GET")).toBe(false);
      const kept = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } });
      expect(kept.unifiPolicyId).toBe(rulePolicy.unifiPolicyId);
      expect(kept.observedFingerprint).toBe(rulePolicy.desiredFingerprint);
      // Nor does it rewrite the record.
      expect(kept.updatedAt).toEqual(rulePolicy.updatedAt);
    });

    it("confirms an unchanged policy recorded without its observed fingerprint, writing nothing to the gateway", async () => {
      const client = fixtureUnifiClient();
      await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: true } });
      const { rulePolicy } = await groupWithRule(client);
      const quarantine = await prisma().appPolicy.findFirstOrThrow({ where: { ownerScope: "quarantine" } });
      await prisma().rulePolicy.update({ where: { id: rulePolicy.id }, data: { observedFingerprint: null } });
      await prisma().appPolicy.update({ where: { id: quarantine.id }, data: { observedFingerprint: null } });
      const writes = client.calls.length;

      await runReconcileOnce();

      expect(client.calls.slice(writes).some((call) => call.method !== "GET")).toBe(false);
      expect((await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } })).observedFingerprint).toBe(rulePolicy.desiredFingerprint);
      expect((await prisma().appPolicy.findUniqueOrThrow({ where: { id: quarantine.id } })).observedFingerprint).toBe(quarantine.desiredFingerprint);
    });

    it("records a failed create on a new rule policy, then creates it on the next pass", async () => {
      const client = fixtureUnifiClient();
      const { group } = await groupWithPolicy(client);
      const rule = await prisma().rule.create({
        data: { name: "Video", kind: RuleKind.category, groups: { create: [{ groupId: group.id }] }, targetIds: [4] },
      });
      client.createError = gatewayError(500, "POST");
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
      expect(failed.unifiPolicyId).toBeNull();
      expect(failed.lastError).toMatch(/500/);

      client.createError = undefined;
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.applied);
      const created = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: failed.id } });
      expect(created.lastError).toBeNull();
      expect(client.state.policies.some((item) => item.id === created.unifiPolicyId)).toBe(true);
    });

    it("records a refused update on the rule policy and keeps the one on the gateway", async () => {
      const client = fixtureUnifiClient();
      const { rule, rulePolicy } = await groupWithRule(client);

      await prisma().rule.update({ where: { id: rule.id }, data: { targetIds: [4, 5] } });
      vi.spyOn(client, "updatePolicy").mockRejectedValueOnce(gatewayError(500, "PUT"));
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const failed = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } });
      expect(failed.lastError).toMatch(/500/);
      expect(failed.unifiPolicyId).toBe(rulePolicy.unifiPolicyId);
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(true);
    });

    it("recreates a rule policy removed on the console, and one that vanishes before its update", async () => {
      const client = fixtureUnifiClient();
      const { rule, rulePolicy } = await groupWithRule(client);

      client.state.policies = client.state.policies.filter((item) => item.id !== rulePolicy.unifiPolicyId);
      await runReconcileOnce();
      const recreated = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } });
      expect(recreated.unifiPolicyId).not.toBe(rulePolicy.unifiPolicyId);
      expect(client.state.policies.some((item) => item.id === recreated.unifiPolicyId)).toBe(true);

      await prisma().rule.update({ where: { id: rule.id }, data: { targetIds: [4, 5] } });
      vi.spyOn(client, "getPolicy").mockRejectedValueOnce(gatewayError(404, "GET"));
      await runReconcileOnce();
      const replaced = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } });
      expect(replaced.unifiPolicyId).not.toBe(recreated.unifiPolicyId);
      expect(replaced.lastError).toBeNull();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("removes a rule's policy once its groups have no assigned devices, and creates it when one returns", async () => {
      const client = fixtureUnifiClient();
      const { group, rule, rulePolicy } = await groupWithRule(client);

      // A device that leaves the group must not stay in the group's rules.
      await prisma().device.update({ where: { mac: MAC }, data: { groupId: null, assignment: AssignmentState.quarantined } });
      await runReconcileOnce();
      expect(await prisma().rulePolicy.findUnique({ where: { id: rulePolicy.id } })).toBeNull();
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(false);

      await prisma().device.update({ where: { mac: MAC }, data: { groupId: group.id, assignment: AssignmentState.assigned } });
      await runReconcileOnce();
      const recreated = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
      expect(policyMacs(client.state.policies.find((item) => item.id === recreated.unifiPolicyId) ?? {})).toContain(MAC);
    });

    it("drops a rule policy that never reached the gateway once its group leaves the rule", async () => {
      const client = fixtureUnifiClient();
      const { group } = await groupWithPolicy(client);
      const rule = await prisma().rule.create({
        data: { name: "Video", kind: RuleKind.category, groups: { create: [{ groupId: group.id }] }, targetIds: [4] },
      });
      client.createError = gatewayError(500, "POST");
      await runReconcileOnce();
      const failed = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
      expect(failed.unifiPolicyId).toBeNull();

      client.createError = undefined;
      await prisma().ruleGroup.deleteMany({ where: { ruleId: rule.id, groupId: group.id } });
      await runReconcileOnce();

      expect(await prisma().rulePolicy.findUnique({ where: { id: failed.id } })).toBeNull();
      expect(await prisma().rule.findUnique({ where: { id: rule.id } })).not.toBeNull();
    });

    it("keeps a rule policy the gateway refused to delete, and removes it on the next pass", async () => {
      const client = fixtureUnifiClient();
      const { group, rulePolicy } = await groupWithRule(client);

      await prisma().ruleGroup.deleteMany({ where: { groupId: group.id } });
      const refusal = refuseDelete(client, rulePolicy.unifiPolicyId);
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const kept = await prisma().rulePolicy.findUniqueOrThrow({ where: { id: rulePolicy.id } });
      expect(kept.lastError).toMatch(/500/);
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(true);

      refusal.mockRestore();
      await runReconcileOnce();
      expect(await prisma().rulePolicy.findUnique({ where: { id: rulePolicy.id } })).toBeNull();
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(false);
    });

    it("blocks an app for a whole network", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      const appId = client.state.dpiApplications[0]!.id;
      const rule = await prisma().rule.create({
        data: { name: "Apps", kind: RuleKind.app, scope: RuleScope.network, networkIds: [IOT_NETWORK], targetIds: [appId] },
      });

      await runReconcileOnce();

      const rulePolicy = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
      const policy = client.state.policies.find((item) => item.id === rulePolicy.unifiPolicyId);
      expect(JSON.stringify(policy?.destination)).toContain(String(appId));
      expect(JSON.stringify(policy?.source)).toContain(IOT_NETWORK);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("deletes a network rule left with only unmanaged networks once its policies are gone", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      const rule = await prisma().rule.create({
        data: { name: "Video", kind: RuleKind.category, scope: RuleScope.network, networkIds: [IOT_NETWORK], targetIds: [4] },
      });
      await runReconcileOnce();
      const rulePolicy = await prisma().rulePolicy.findFirstOrThrow({ where: { ruleId: rule.id } });
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(true);

      // The operator stops managing the rule's only network, and the gateway refuses the first delete.
      await configureConnectedHousehold({ manageAllNetworks: false, managedNetworkIds: [INTERNAL_NETWORK] });
      const refusal = refuseDelete(client, rulePolicy.unifiPolicyId);
      await runReconcileOnce();
      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      expect(await prisma().rule.findUnique({ where: { id: rule.id } })).not.toBeNull();
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(true);

      refusal.mockRestore();
      await runReconcileOnce();
      expect(await prisma().rule.findUnique({ where: { id: rule.id } })).toBeNull();
      expect(client.state.policies.some((item) => item.id === rulePolicy.unifiPolicyId)).toBe(false);
      expect(client.state.policies.find((item) => item.id === ADMIN_POLICY_ID)?.name).toBe("Allow LAN DNS");
    });
  });

  describe("orphaned policies", () => {
    it("keeps the creation record and reports a partial run when the gateway refuses the delete", async () => {
      const client = fixtureUnifiClient();
      const { group, policy } = await groupWithPolicy(client);
      await prisma().rulePolicy.delete({ where: { id: policy.id } });
      await prisma().device.update({ where: { mac: MAC }, data: { groupId: null, assignment: AssignmentState.quarantined } });
      await prisma().group.delete({ where: { id: group.id } });

      const refusal = refuseDelete(client, policy.unifiPolicyId);
      await runReconcileOnce();

      expect((await lastRun()).status).toBe(ChangeStatus.partial);
      const creation = await prisma().policyOperation.findFirstOrThrow({ where: { unifiPolicyId: policy.unifiPolicyId } });
      expect(creation.status).toBe("applied");
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(true);

      refusal.mockRestore();
      await runReconcileOnce();
      expect(client.state.policies.some((item) => item.id === policy.unifiPolicyId)).toBe(false);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });
  });

  describe("the background queue", () => {
    async function settled() {
      await vi.waitFor(
        async () => {
          const run = await prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } });
          expect(run?.finishedAt).toBeTruthy();
          const lock = await prisma().reconciliationLock.findUnique({ where: { id: "global" } });
          expect(lock?.expiresAt.getTime()).toBe(0);
        },
        { timeout: 10_000, interval: 50 },
      );
    }

    it("runs a pass in the background on request once automatic reconciliation is on", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);

      requestReconcile();
      expect(client.calls).toHaveLength(0);

      setAutoReconcileForTests(true);
      requestReconcile();
      await settled();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("retries a pass that failed before it started", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      vi.spyOn(prisma().reconciliationLock, "findUnique").mockRejectedValueOnce(new Error("database restarting"));

      setAutoReconcileForTests(true);
      requestReconcile();
      await settled();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("waits for another owner's lock to expire, then runs", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      await prisma().reconciliationLock.create({
        data: { id: "global", owner: "other", expiresAt: new Date(Date.now() + 1_500) },
      });

      setAutoReconcileForTests(true);
      requestReconcile();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await prisma().syncRun.count()).toBe(0);

      await settled();
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("keeps the lock through a pass that outlasts it, so no second pass starts", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      setReconcileLockForTests({ lockMs: 400, renewMs: 100 });
      const listPolicies = client.listPolicies.bind(client);
      let release!: () => void;
      const slow = new Promise<void>((resolve) => (release = resolve));
      vi.spyOn(client, "listPolicies").mockImplementationOnce(async (siteId) => {
        await slow;
        return listPolicies(siteId);
      });

      const first = runReconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // One renewal cannot reach the database; the next ones keep the lock.
      vi.spyOn(prisma().reconciliationLock, "updateMany").mockRejectedValueOnce(new Error("database restarting"));
      await new Promise((resolve) => setTimeout(resolve, 950));
      expect(await runReconcileOnce()).toBe(false);
      release();

      expect(await first).toBe(true);
      expect(await prisma().syncRun.count()).toBe(1);
      expect((await lastRun()).status).toBe(ChangeStatus.applied);
    });

    it("stops before its next gateway write once another owner holds the lock", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      setReconcileLockForTests({ lockMs: 400, renewMs: 100 });
      const listPolicies = client.listPolicies.bind(client);
      let release!: () => void;
      const slow = new Promise<void>((resolve) => (release = resolve));
      vi.spyOn(client, "listPolicies").mockImplementationOnce(async (siteId) => {
        await slow;
        return listPolicies(siteId);
      });

      const pass = runReconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 200));
      // As if this process had stalled and another one took over.
      await prisma().reconciliationLock.update({
        where: { id: "global" },
        data: { owner: "other", expiresAt: new Date(Date.now() + 60_000) },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const before = client.calls.length;
      release();

      expect(await pass).toBe(true);
      expect(client.calls.slice(before).some((call) => call.method !== "GET")).toBe(false);
      const run = await lastRun();
      expect(run.status).toBe(ChangeStatus.failed);
      expect(run.error).toMatch(/Another sync took over/);
      const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
      expect(household.connectionStatus).not.toBe("error");
      expect((await prisma().reconciliationLock.findUniqueOrThrow({ where: { id: "global" } })).owner).toBe("other");
    });

    it("never takes back a lock another owner took and released while its renewals failed", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      setReconcileLockForTests({ lockMs: 400, renewMs: 100 });
      const listPolicies = client.listPolicies.bind(client);
      let release!: () => void;
      const slow = new Promise<void>((resolve) => (release = resolve));
      vi.spyOn(client, "listPolicies").mockImplementationOnce(async (siteId) => {
        await slow;
        return listPolicies(siteId);
      });

      const pass = runReconcileOnce();
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Another process ran a whole pass in the gap and released the lock, which keeps its owner.
      await prisma().reconciliationLock.update({
        where: { id: "global" },
        data: { owner: "other", expiresAt: new Date(0) },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const before = client.calls.length;
      release();

      expect(await pass).toBe(true);
      expect(client.calls.slice(before).some((call) => call.method !== "GET")).toBe(false);
      expect((await lastRun()).error).toMatch(/Another sync took over/);
      expect((await prisma().reconciliationLock.findUniqueOrThrow({ where: { id: "global" } })).owner).toBe("other");
    });

    it("leaves pending changes for the pass that took over when the lock goes after the last write", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      setReconcileLockForTests({ lockMs: 400, renewMs: 100 });
      const group = await createFamilyGroup("Betsy");
      await seedDevice({ mac: MAC, groupId: group.id, assignment: AssignmentState.assigned });
      await pauseGroup(group.id);
      await prisma().changeResult.create({
        data: { scope: "group", status: ChangeStatus.pending, requestedRevision: 0 },
      });
      // The pass's own coverage read is its last step before settling; the lock goes meanwhile.
      const coverage = prisma().device.findMany.bind(prisma().device);
      let taken = false;
      vi.spyOn(prisma().device, "findMany").mockImplementation((async (...args: Parameters<typeof coverage>) => {
        if (!taken && client.calls.some((call) => call.method === "POST")) {
          taken = true;
          await prisma().reconciliationLock.update({
            where: { id: "global" },
            data: { owner: "other", expiresAt: new Date(Date.now() + 60_000) },
          });
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return coverage(...args);
      }) as unknown as typeof coverage);

      expect(await runReconcileOnce()).toBe(true);
      expect(taken).toBe(true);
      expect((await lastRun()).status).toBe(ChangeStatus.failed);
      const pending = await prisma().changeResult.findFirstOrThrow({});
      expect(pending.status).toBe(ChangeStatus.pending);
    });

    it("starts with a pass straight away and schedules the next ones", async () => {
      const client = fixtureUnifiClient();
      setReconcileClientForTests(client);
      const timers: ReturnType<typeof setInterval>[] = [];
      const schedule = globalThis.setInterval;
      vi.spyOn(globalThis, "setInterval").mockImplementation(((handler: () => void, ms: number) => {
        const timer = schedule(handler, ms);
        timers.push(timer);
        return timer;
      }) as typeof setInterval);

      setAutoReconcileForTests(true);
      try {
        startReconciliation();
        expect(timers).toHaveLength(1);
        await settled();
        expect((await lastRun()).status).toBe(ChangeStatus.applied);
      } finally {
        timers.forEach((timer) => clearInterval(timer));
      }
    });
  });
});
