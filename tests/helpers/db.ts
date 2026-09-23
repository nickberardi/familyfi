import { AssignmentState, GroupKind, FamilyRole } from "@prisma/client";
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
  // Refuse anything but the test database: this empties whatever it is pointed at.
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (name !== TEST_POSTGRES_DB) {
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

export async function createFamilyGroup(name = "Betsy", role: FamilyRole = FamilyRole.child) {
  return prisma().group.create({
    data: {
      kind: GroupKind.family,
      name,
      familyRole: role,
      mode: "scheduled",
      scheduleEnabled: true,
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleStart: "21:30",
      scheduleEnd: "06:45",
    },
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
      zoneId: input.zoneId ?? INTERNAL_ZONE,
      networkId: input.networkId ?? INTERNAL_NETWORK,
      assignment: input.assignment ?? (input.groupId ? AssignmentState.assigned : AssignmentState.quarantined),
    },
  });
}
