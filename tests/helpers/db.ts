import { AssignmentState, GroupKind, FamilyRole, RuleKind, RuleMode } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureHousehold, ensureRecoveryAccount } from "@/server/auth";
import { setAutoReconcileForTests, setReconcileClientForTests } from "@/server/reconciliation";
import { resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { TEST_POSTGRES_DB } from "./test-env";

export const SITE_ID = "11111111-1111-4111-8111-111111111111";
export const INTERNAL_ZONE = "33333333-3333-4333-8333-333333333333";
export const IOT_ZONE = "33333333-3333-4333-8333-333333333334";
export const ADMIN_POLICY_ID = "55555555-5555-4555-8555-555555555555";
export const INTERNAL_NETWORK = "22222222-2222-4222-8222-222222222222";
export const IOT_NETWORK = "22222222-2222-4222-8222-222222222223";

export async function resetDatabase() {
  setAutoReconcileForTests(false);
  setReconcileClientForTests(undefined);
  resetDevMockClientForTests();
  const db = prisma();
  // Refuse anything but the test database: this empties whatever it is pointed at. The in-memory
  // PGlite of `scripts/test.py run --database memory` serves one database of its own name, and exists
  // only for the run.
  const [{ name, version }] = await db.$queryRaw<{ name: string; version: string }[]>`SELECT current_database() AS name, version() AS version`;
  if (name !== TEST_POSTGRES_DB && !version.includes("wasm32")) {
    throw new Error(`resetDatabase only runs against ${TEST_POSTGRES_DB}, not ${name}.`);
  }
  for (const table of await tablesChildrenFirst()) {
    await db.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  await ensureHousehold();
  await ensureRecoveryAccount();
}

/**
 * Every table in the schema, found at run time so a new model can never be left out of
 * the reset, ordered so each table is emptied before any table it references. Row-level
 * DELETE rather than TRUNCATE: TRUNCATE's exclusive lock deadlocks with background work
 * (reconcile pump, probe sweep, tunnel lease) that a previous test left running.
 */
async function tablesChildrenFirst(): Promise<string[]> {
  const db = prisma();
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  const references = await db.$queryRaw<{ child: string; parent: string }[]>`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    WHERE fk.contype = 'f' AND fk.connamespace = current_schema()::regnamespace`;
  const remaining = new Set(tables.map((table) => table.name));
  const ordered: string[] = [];
  while (remaining.size) {
    const next = [...remaining].filter(
      (table) => !references.some(({ child, parent }) => parent === table && child !== table && remaining.has(child)),
    );
    if (!next.length) throw new Error(`Foreign keys form a cycle among: ${[...remaining].join(", ")}`);
    for (const table of next) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

export async function configureConnectedHousehold(input?: {
  manageAllNetworks?: boolean;
  managedNetworkIds?: string[];
}) {
  return prisma().household.update({
    where: { id: "default" },
    data: {
      unifiMode: "local",
      unifiBaseUrl: "https://10.1.2.1/proxy/network/integration",
      unifiSiteId: SITE_ID,
      connectionStatus: "ok",
      unifiManageAllNetworks: input?.manageAllNetworks ?? true,
      unifiManagedNetworkIds: input?.managedNetworkIds ?? [],
      revision: 1,
    },
  });
}

/** A child with a school-night Bedtime internet rule, 21:30–06:45 Monday to Friday. */
export async function createFamilyGroup(name = "Betsy", role: FamilyRole = FamilyRole.child) {
  const group = await prisma().group.create({
    data: { kind: GroupKind.family, name, familyRole: role },
  });
  await createInternetRule([group.id]);
  return group;
}

/** An internet rule with one window per entry (Bedtime, school nights, by default). */
export async function createInternetRule(
  groupIds: string[],
  windows: { name?: string; days: number[]; start: string; end: string }[] = [
    { name: "Bedtime", days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" },
  ],
  name = "Bedtime",
) {
  return prisma().rule.create({
    data: {
      name,
      kind: RuleKind.internet,
      mode: RuleMode.scheduled,
      groups: { create: groupIds.map((groupId) => ({ groupId })) },
      windows: { create: windows.map((window, position) => ({ position, name: window.name ?? "", days: window.days, start: window.start, end: window.end })) },
    },
    include: { windows: true },
  });
}

export async function seedDevice(input: {
  mac: string;
  groupId?: string | null;
  zoneId?: string | null;
  networkId?: string | null;
  assignment?: AssignmentState;
}) {
  return prisma().device.create({
    data: {
      mac: input.mac,
      groupId: input.groupId ?? null,
      // `null` is a device with no firewall zone, not a request for the default.
      zoneId: input.zoneId === undefined ? INTERNAL_ZONE : input.zoneId,
      networkId: input.networkId ?? INTERNAL_NETWORK,
      assignment: input.assignment ?? (input.groupId ? AssignmentState.assigned : AssignmentState.quarantined),
    },
  });
}
