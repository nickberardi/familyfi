/**
 * Randomised reconciler tests. Hand-written scenarios check the cases someone thought of;
 * these generate households, gateways and sequences of changes, reconcile after every
 * step, and check the rules FamilyFi promises (AGENTS.md, docs/architecture.md) against
 * the resulting gateway. The expected state is worked out here from the database, not by
 * calling the planner, so a planner bug cannot hide behind its own answer.
 *
 * On failure fast-check prints the seed and the shrunk sequence; pass them to `fc.assert`
 * as `{ seed, path }` to replay exactly that case.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { AssignmentState, FamilyRole, GroupKind, GroupMode } from "@prisma/client";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import { toUnifiSchedule } from "@/server/unifi/schedule-map";
import type { FirewallPolicy } from "@/server/unifi/types";
import { INTERNAL_NETWORK, IOT_NETWORK, configureConnectedHousehold, resetDatabase } from "../helpers/db";
import { policyMacs } from "../helpers/unifi-world";

const MACS = [1, 2, 3, 4, 5].map((n) => `02:00:00:00:01:0${n}`);
const GROUP_COUNT = 3;
/** Where a client can sit: a subnet the gateway maps to a network, or one it does not know. */
const PLACES = {
  internal: { ip: (n: number) => `192.0.2.${100 + n}` },
  iot: { ip: (n: number) => `198.51.100.${100 + n}` },
  elsewhere: { ip: (n: number) => `203.0.113.${100 + n}` },
} as const;
type Place = keyof typeof PLACES | "absent";

type GroupSpec = {
  protected: boolean;
  mode: GroupMode;
  schedule: { days: number[]; start: string; end: string } | null;
  paused: boolean;
};

type World = {
  manageAll: boolean;
  managed: string[];
  quarantineEnforced: boolean;
  groups: GroupSpec[];
  places: Place[];
  /** Each device's group once discovered, or null to leave it in quarantine. */
  assignments: (number | null)[];
  lookalikes: string[];
};

type Step =
  | { kind: "assign"; mac: number; group: number | null }
  | { kind: "protect"; group: number; value: boolean }
  | { kind: "pause"; group: number }
  | { kind: "resume"; group: number }
  | { kind: "mode"; group: number; mode: GroupMode }
  | { kind: "move"; mac: number; place: Place }
  | { kind: "deleteGroup"; group: number }
  | { kind: "deleteDevice"; mac: number }
  | { kind: "quarantine"; enforced: boolean };

const place = fc.constantFrom<Place>("internal", "iot", "elsewhere", "absent");
const groupIndex = fc.integer({ min: 0, max: GROUP_COUNT - 1 });
const macIndex = fc.integer({ min: 0, max: MACS.length - 1 });

const world: fc.Arbitrary<World> = fc.record({
  manageAll: fc.boolean(),
  managed: fc.subarray([INTERNAL_NETWORK, IOT_NETWORK]),
  quarantineEnforced: fc.boolean(),
  groups: fc.array(
    fc.record({
      protected: fc.boolean(),
      mode: fc.constantFrom(GroupMode.always, GroupMode.scheduled),
      schedule: fc.option(
        fc.record({
          days: fc.subarray([0, 1, 2, 3, 4, 5, 6], { minLength: 1 }),
          start: fc.constantFrom("21:00", "21:30", "13:00"),
          end: fc.constantFrom("06:45", "07:00", "15:00"),
        }),
        { nil: null },
      ),
      paused: fc.boolean(),
    }),
    { minLength: GROUP_COUNT, maxLength: GROUP_COUNT },
  ),
  places: fc.array(place, { minLength: MACS.length, maxLength: MACS.length }),
  assignments: fc.array(fc.option(groupIndex, { nil: null, freq: 3 }), { minLength: MACS.length, maxLength: MACS.length }),
  // Administrator policies, some named like ours: the name must never make them ours.
  lookalikes: fc.subarray(["Allow printer", "FamilyFi Kids bedtime", "FamilyFi Quarantine Internal Devices"]),
});

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant("assign" as const), mac: macIndex, group: fc.option(groupIndex, { nil: null }) }),
  fc.record({ kind: fc.constant("protect" as const), group: groupIndex, value: fc.boolean() }),
  fc.record({ kind: fc.constant("pause" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("resume" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("mode" as const), group: groupIndex, mode: fc.constantFrom(GroupMode.always, GroupMode.scheduled) }),
  fc.record({ kind: fc.constant("move" as const), mac: macIndex, place }),
  fc.record({ kind: fc.constant("deleteGroup" as const), group: groupIndex }),
  fc.record({ kind: fc.constant("deleteDevice" as const), mac: macIndex }),
  fc.record({ kind: fc.constant("quarantine" as const), enforced: fc.boolean() }),
);

type Client = ReturnType<typeof createFixtureUnifiClient>;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PAUSED_UNTIL = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

function placeClient(client: Client, mac: number, where: Place) {
  const id = `44444444-4444-4444-8444-5555555555${String(mac).padStart(2, "0")}`;
  client.state.clients = client.state.clients.filter((row) => row.id !== id);
  if (where === "absent") return;
  client.state.clients.push({ id, name: `device ${mac}`, type: "WIRELESS", ipAddress: PLACES[where].ip(mac), macAddress: MACS[mac] });
}

async function build(spec: World): Promise<{ client: Client; groupIds: string[]; admin: Map<string, string> }> {
  await resetDatabase();
  await configureConnectedHousehold({ manageAllNetworks: spec.manageAll, managedNetworkIds: spec.managed });
  await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: spec.quarantineEnforced } });
  const client = createFixtureUnifiClient();
  client.state.clients = [];
  spec.places.forEach((where, mac) => placeClient(client, mac, where));
  const template = client.state.policies[0]!;
  spec.lookalikes.forEach((name, n) => {
    client.state.policies.push({ ...template, id: `77777777-7777-4777-8777-77777777777${n}`, name, index: 20 + n });
  });
  // Byte-for-byte snapshot of every policy an administrator made.
  const admin = new Map(client.state.policies.map((policy) => [policy.id, JSON.stringify(policy)]));

  const groupIds: string[] = [];
  for (const [n, group] of spec.groups.entries()) {
    const row = await prisma().group.create({
      data: {
        kind: GroupKind.family,
        familyRole: FamilyRole.child,
        name: `Group ${n}`,
        protected: group.protected,
        mode: group.mode,
        scheduleEnabled: group.schedule !== null,
        scheduleDays: group.schedule?.days ?? [],
        scheduleStart: group.schedule?.start ?? null,
        scheduleEnd: group.schedule?.end ?? null,
        suspensionActive: group.paused,
        suspensionUntil: group.paused ? PAUSED_UNTIL() : null,
      },
    });
    groupIds.push(row.id);
  }
  setReconcileClientForTests(client);
  return { client, groupIds, admin };
}

async function apply(change: Step, client: Client, groupIds: string[]) {
  const db = prisma();
  const groupId = "group" in change && change.group !== null ? groupIds[change.group] : null;
  switch (change.kind) {
    case "assign": {
      const device = await db.device.findUnique({ where: { mac: MACS[change.mac] } });
      const target = groupId ? await db.group.findUnique({ where: { id: groupId } }) : null;
      if (!device || (groupId && !target)) return;
      await db.device.update({
        where: { mac: MACS[change.mac] },
        data: target
          ? { groupId: target.id, assignment: AssignmentState.assigned }
          : { groupId: null, assignment: AssignmentState.quarantined },
      });
      return;
    }
    case "protect":
      await db.group.updateMany({ where: { id: groupId! }, data: { protected: change.value } });
      return;
    case "pause":
      await db.group.updateMany({ where: { id: groupId! }, data: { suspensionActive: true, suspensionUntil: PAUSED_UNTIL() } });
      return;
    case "resume":
      await db.group.updateMany({ where: { id: groupId! }, data: { suspensionActive: false, suspensionUntil: null } });
      return;
    case "mode":
      await db.group.updateMany({ where: { id: groupId! }, data: { mode: change.mode } });
      return;
    case "move":
      placeClient(client, change.mac, change.place);
      return;
    case "deleteGroup":
      await db.group.deleteMany({ where: { id: groupId! } });
      return;
    case "deleteDevice":
      await db.device.deleteMany({ where: { mac: MACS[change.mac] } });
      return;
    case "quarantine":
      await db.household.update({ where: { id: "default" }, data: { quarantineEnforced: change.enforced } });
      return;
  }
}

/** Every rule the gateway must satisfy after a reconcile, checked from scratch. */
async function checkGateway(client: Client, admin: Map<string, string>) {
  const db = prisma();
  const [household, groups, devices, records] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: "default" } }),
    db.group.findMany(),
    db.device.findMany(),
    db.appPolicy.findMany(),
  ]);

  // Administrator policies: untouched, byte for byte, whatever they are named.
  for (const [id, snapshot] of admin) {
    const now = client.state.policies.find((policy) => policy.id === id);
    expect(now && JSON.stringify(now), `administrator policy ${id}`).toBe(snapshot);
  }
  for (const call of client.calls.filter((call) => WRITES.has(call.method))) {
    expect(call.path, "ordering is never written").not.toMatch(/ordering/);
    expect([...admin.keys()].some((id) => call.path.includes(id)), `${call.method} ${call.path}`).toBe(false);
  }

  // Ownership: every policy FamilyFi added is on record, and every record is on the gateway.
  const byId = new Map(client.state.policies.map((policy) => [policy.id, policy]));
  const recorded = new Map(records.filter((row) => row.unifiPolicyId).map((row) => [row.unifiPolicyId!, row]));
  for (const policy of client.state.policies) {
    if (!admin.has(policy.id)) expect(recorded.has(policy.id), `unrecorded policy ${policy.name}`).toBe(true);
  }
  for (const id of recorded.keys()) expect(byId.has(id), `record ${id} points at no policy`).toBe(true);
  const owners = [...recorded.values()].map((row) => `${row.ownerScope}:${row.groupId}|${row.zoneId}`);
  expect(new Set(owners).size, "one policy per owner and zone").toBe(owners.length);

  const ours = [...recorded.entries()].map(([id, row]) => ({ row, policy: byId.get(id)! }));
  const inScope = (networkId: string | null) =>
    household.unifiManageAllNetworks || (networkId !== null && household.unifiManagedNetworkIds.includes(networkId));
  const groupById = new Map(groups.map((group) => [group.id, group]));

  // Membership: a managed device sits in exactly the policy it belongs to, or in none.
  for (const device of devices) {
    // Off a managed network, or in no known zone: its group's policy is kept on purpose.
    if (!inScope(device.networkId) || !device.zoneId) continue;
    const group = device.assignment === AssignmentState.assigned && device.groupId ? groupById.get(device.groupId) : undefined;
    const holding = ours.filter(({ policy }) => policyMacs(policy).includes(device.mac));
    if (group?.protected) {
      expect(holding.map(({ policy }) => policy.name), `${device.mac} in protected ${group.name}`).toEqual([]);
      continue;
    }
    expect(holding.length, `${device.mac} policies: ${holding.map(({ policy }) => policy.name).join(", ")}`).toBe(1);
    const [{ row }] = holding;
    expect(row.zoneId).toBe(device.zoneId);
    if (group) expect([row.ownerScope, row.groupId]).toEqual(["group", group.id]);
    else expect(row.ownerScope).toBe("quarantine");
  }

  // Enforcement: pause disables a group's policies but keeps its schedule; quarantine
  // follows the household switch.
  for (const { row, policy } of ours) {
    if (row.ownerScope === "quarantine") {
      expect(policy.enabled, `quarantine ${policy.name}`).toBe(household.quarantineEnforced);
      continue;
    }
    const group = row.groupId ? groupById.get(row.groupId) : undefined;
    if (!group) continue;
    const paused = group.suspensionActive && (!group.suspensionUntil || group.suspensionUntil > new Date());
    expect(policy.enabled, `${group.name} paused=${paused}`).toBe(!paused);
    const schedule =
      group.mode === GroupMode.scheduled && group.scheduleEnabled && group.scheduleStart && group.scheduleEnd
        ? toUnifiSchedule({ enabled: true, days: group.scheduleDays, start: group.scheduleStart, end: group.scheduleEnd })
        : undefined;
    expect((policy as FirewallPolicy).schedule ?? undefined, `${group.name} schedule`).toEqual(schedule);
  }
}

describe("reconciliation properties", () => {
  it(
    "keeps the gateway right after every change, and settles in one pass",
    async () => {
      await fc.assert(
        fc.asyncProperty(world, fc.array(step, { maxLength: 6 }), async (spec, changes) => {
          const { client, groupIds, admin } = await build(spec);
          try {
            expect(await runReconcileOnce()).toBe(true);
            await checkGateway(client, admin);
            // Discovery has quarantined every managed device; now the household sorts them.
            for (const [mac, group] of spec.assignments.entries()) {
              await apply({ kind: "assign", mac, group }, client, groupIds);
            }
            expect(await runReconcileOnce()).toBe(true);
            await checkGateway(client, admin);
            for (const change of changes) {
              await apply(change, client, groupIds);
              expect(await runReconcileOnce()).toBe(true);
              await checkGateway(client, admin);
            }
            // Nothing changed since the last pass, so the next one writes nothing.
            client.calls.length = 0;
            expect(await runReconcileOnce()).toBe(true);
            expect(client.calls.filter((call) => WRITES.has(call.method))).toEqual([]);
          } finally {
            setReconcileClientForTests(undefined);
          }
        }),
        { numRuns: 40 },
      );
    },
    180_000,
  );
});
