import { AccountKind, AssignmentState, FamilyRole, GroupKind, UpstreamVerdict } from "@prisma/client";
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
const PAUSED_MAC = "02:00:00:00:00:04";
const LOOSE_MAC = "02:00:00:00:00:05";

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
      mode: "scheduled",
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
      mode: "scheduled",
      scheduleEnabled: true,
      scheduleDays: [0, 1, 2, 3, 4, 5, 6],
      scheduleStart: "22:30",
      scheduleEnd: "07:00",
    },
  });
  // Paused, so the card's paused ink and its Resume/Extend actions are visible.
  const paused = await prisma().group.create({
    data: {
      kind: GroupKind.family,
      name: "Robin",
      familyRole: FamilyRole.teen,
      mode: "scheduled",
      scheduleEnabled: true,
      scheduleDays: [1, 2, 3, 4, 5],
      scheduleStart: "22:00",
      scheduleEnd: "06:30",
      suspensionActive: true,
      suspensionUntil: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  // A things group carries the 44px monogram tile a person's card goes without.
  const things = await prisma().group.create({
    data: {
      kind: GroupKind.things,
      name: "Living Room",
      monogram: "TV",
      mode: "scheduled",
      scheduleEnabled: true,
      scheduleDays: [0, 1, 2, 3, 4, 5, 6],
      scheduleStart: "23:00",
      scheduleEnd: "07:00",
    },
  });
  // No devices and no schedule — the emptiest comfortable card there is.
  await prisma().group.create({
    data: { kind: GroupKind.things, name: "Smart Home", monogram: "IOT" },
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
      {
        mac: PAUSED_MAC,
        hostname: "Robin iPad",
        ip: "192.0.2.40",
        networkId: DEV_MOCK_INTERNAL_NETWORK,
        zoneId: DEV_MOCK_INTERNAL_ZONE,
        groupId: paused.id,
        assignment: AssignmentState.assigned,
      },
      // Unassigned, so the Devices quarantine banner and its counts have a subject.
      {
        mac: LOOSE_MAC,
        hostname: "Guest Laptop",
        ip: "192.0.2.50",
        networkId: DEV_MOCK_INTERNAL_NETWORK,
        zoneId: DEV_MOCK_INTERNAL_ZONE,
        assignment: AssignmentState.quarantined,
      },
    ],
  });
}

/**
 * A measured upstream verdict for three curated slots, so the DNS-derived mark states
 * are visible without a real resolver — the same reason the mock household exists.
 *
 * One slot per state that has a colour: Social blocked, Gaming partial, VPN measured
 * open. Video and Messaging are deliberately left unmeasured, because "we never looked"
 * has to stay visibly distinct from "we looked and it is clear" — that is the pair most
 * likely to regress, and collapsing it is exactly the false assurance to avoid.
 */
async function ensureMockUpstreamChecks() {
  const measured: { slug: string; verdict: UpstreamVerdict; blockedCount: number }[] = [
    { slug: "social", verdict: UpstreamVerdict.blocked, blockedCount: 20 },
    { slug: "gaming", verdict: UpstreamVerdict.partial, blockedCount: 7 },
    { slug: "vpn", verdict: UpstreamVerdict.open, blockedCount: 0 },
  ];
  for (const item of measured) {
    const category = await prisma().upstreamCategory.findUnique({
      where: { slug: item.slug },
      select: { id: true },
    });
    if (!category) continue;
    const existing = await prisma().upstreamCheck.findFirst({
      where: { categoryId: category.id, groupId: null },
      select: { id: true },
    });
    if (existing) continue;
    // Real per-domain results, not an empty array — otherwise every domain row on
    // the category detail screen reads "Not checked" no matter what the category
    // chip says, which is the exact mismatch the mock exists to catch.
    const domains = await prisma().upstreamDomain.findMany({
      where: { categoryId: category.id, removedAt: null },
      select: { domain: true },
      orderBy: { domain: "asc" },
    });
    const results = domains.map(({ domain }, index) => ({
      domain,
      blocked: index < item.blockedCount,
      rcode: index < item.blockedCount ? 3 : 0,
    }));
    await prisma().upstreamCheck.create({
      data: {
        categoryId: category.id,
        groupId: null,
        verdict: item.verdict,
        blockedCount: item.blockedCount,
        totalCount: domains.length,
        results,
        durationMs: 120,
      },
    });
  }
}

/** Populate groups, a personal adult login, devices, and mock UniFi so the UI is usable without a console. */
export async function ensureDevDummyData() {
  if (!unifiMockEnabled()) return;
  await ensureMockUnifiConnection();
  await ensureDummyHouseholdMembers();
  await ensureMockUpstreamChecks();
}
