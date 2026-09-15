import { AccountKind, AssignmentState, FamilyRole, GroupKind } from "@prisma/client";
import { hashPassword } from "./auth";
import { encryptSecret } from "./crypto";
import { prisma } from "./db";
import { recoveryPassword, unifiMockEnabled } from "./env";
import {
  DEV_MOCK_API_KEY,
  DEV_MOCK_BASE_URL,
  DEV_MOCK_INTERNAL_NETWORK,
  DEV_MOCK_INTERNAL_ZONE,
  DEV_MOCK_IOT_NETWORK,
  DEV_MOCK_IOT_ZONE,
  DEV_MOCK_SITE_ID,
} from "./unifi/dev-mock";

export const DEV_SEED_ADULT_USERNAME = "pat";

const CHILD_MAC = "02:00:00:00:00:01";
const THINGS_MAC = "02:00:00:00:00:02";
const TEEN_MAC = "02:00:00:00:00:03";

async function ensureMockUnifiConnection() {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (household.unifiKeyLastFour) return;
  const secret = encryptSecret(DEV_MOCK_API_KEY);
  await prisma().household.update({
    where: { id: "default" },
    data: {
      unifiMode: "local",
      unifiBaseUrl: DEV_MOCK_BASE_URL,
      unifiConsoleId: null,
      unifiSiteId: DEV_MOCK_SITE_ID,
      unifiTlsInsecure: true,
      unifiManageAllNetworks: true,
      unifiManagedNetworkIds: [],
      unifiKeyCiphertext: Uint8Array.from(secret.ciphertext),
      unifiKeyIv: Uint8Array.from(secret.iv),
      unifiKeyAuthTag: Uint8Array.from(secret.authTag),
      unifiKeyLastFour: DEV_MOCK_API_KEY.slice(-4),
      connectionStatus: "connected",
      connectionError: null,
    },
  });
}

async function ensureDummyHouseholdMembers() {
  const existing = await prisma().group.count({ where: { kind: GroupKind.family } });
  if (existing > 0) return;

  const adult = await prisma().group.create({
    data: { kind: GroupKind.family, name: "Pat", familyRole: FamilyRole.adult, protected: true },
  });
  const child = await prisma().group.create({
    data: {
      kind: GroupKind.family,
      name: "Betsy",
      familyRole: FamilyRole.child,
      scheduleEnabled: true,
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleStart: "21:30",
      scheduleEnd: "06:45",
    },
  });
  const teen = await prisma().group.create({
    data: {
      kind: GroupKind.family,
      name: "Sam",
      familyRole: FamilyRole.teen,
      scheduleEnabled: true,
      scheduleDays: [0, 1, 2, 3, 4, 5, 6],
      scheduleStart: "22:30",
      scheduleEnd: "07:00",
    },
  });
  const things = await prisma().group.create({
    data: { kind: GroupKind.things, name: "Living Room" },
  });

  const password = recoveryPassword();
  await prisma().account.create({
    data: {
      username: DEV_SEED_ADULT_USERNAME,
      displayName: "Pat",
      kind: AccountKind.personal,
      isAdmin: true,
      groupId: adult.id,
      passwordHash: await hashPassword(password),
    },
  });

  await prisma().device.createMany({
    data: [
      {
        mac: CHILD_MAC,
        hostname: "Kids iPad",
        ip: "192.0.2.20",
        networkId: DEV_MOCK_INTERNAL_NETWORK,
        zoneId: DEV_MOCK_INTERNAL_ZONE,
        groupId: child.id,
        assignment: AssignmentState.assigned,
      },
      {
        mac: THINGS_MAC,
        hostname: "Living Room TV",
        ip: "198.51.100.20",
        networkId: DEV_MOCK_IOT_NETWORK,
        zoneId: DEV_MOCK_IOT_ZONE,
        groupId: things.id,
        assignment: AssignmentState.assigned,
      },
      {
        mac: TEEN_MAC,
        hostname: "Sam Phone",
        ip: "192.0.2.30",
        networkId: DEV_MOCK_INTERNAL_NETWORK,
        zoneId: DEV_MOCK_INTERNAL_ZONE,
        groupId: teen.id,
        assignment: AssignmentState.assigned,
      },
    ],
  });
}

/** Populate groups, a personal adult login, devices, and mock UniFi so the UI is usable without a console. */
export async function ensureDevDummyData() {
  if (!unifiMockEnabled()) return;
  await ensureMockUnifiConnection();
  await ensureDummyHouseholdMembers();
}
