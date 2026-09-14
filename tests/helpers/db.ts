import { AssignmentState, GroupKind, FamilyRole } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureHousehold, ensureRecoveryAccount } from "@/server/auth";
import { setAutoReconcileForTests, setReconcileClientForTests } from "@/server/reconciliation";

export const SITE_ID = "11111111-1111-4111-8111-111111111111";
export const INTERNAL_ZONE = "33333333-3333-4333-8333-333333333333";
export const IOT_ZONE = "33333333-3333-4333-8333-333333333334";
export const ADMIN_POLICY_ID = "55555555-5555-4555-8555-555555555555";
export const INTERNAL_NETWORK = "22222222-2222-4222-8222-222222222222";
export const IOT_NETWORK = "22222222-2222-4222-8222-222222222223";

export async function resetDatabase() {
  setAutoReconcileForTests(false);
  setReconcileClientForTests(undefined);
  const db = prisma();
  await db.changeResult.deleteMany();
  await db.syncRun.deleteMany();
  await db.policyOperation.deleteMany();
  await db.appPolicy.deleteMany();
  await db.device.deleteMany();
  await db.session.deleteMany();
  await db.loginAttempt.deleteMany();
  await db.account.deleteMany();
  await db.group.deleteMany();
  await db.reconciliationLock.deleteMany();
  await db.household.deleteMany();
  await ensureHousehold();
  await ensureRecoveryAccount();
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
