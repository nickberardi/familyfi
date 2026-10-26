import { isDeepStrictEqual } from "node:util";
import { AssignmentState, ChangeStatus, IpVersion, PolicyOperationIntent, PolicyOwnerScope, Prisma, RuleScope, type Household } from "@prisma/client";
import { LOCK_DNS_RULE_ID, QUARANTINE_RULE_ID } from "@/lib/rules";
import { isSuspended } from "@/lib/schedule";
import { randomToken } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import { normalizeMac } from "./mac";
import { macRegistrants } from "./mac-vendor";
import { loadNetworkClientIds, loadNetworkDetails } from "./unifi/networks";
import { clientForHousehold, connectionIdentity, ownershipScope } from "./unifi/connection";
import { withPolicyOwnership } from "./unifi/policy-ownership";
import { reclaims, settleLostCreates } from "./unifi/lost-creates";
import { UnifiHttpError } from "./unifi/errors";
import { policyFingerprint } from "./unifi/fingerprint";
import { mapClientsToZones, selectExternalZone } from "./unifi/mapping";
import { internetBlockPolicy, toPolicyUpdate } from "./unifi/payloads";
import { networkInScope, publicUnifiNetwork } from "./unifi/scope";
import { rememberSiteNetworks } from "./unifi/network-cache";
import { recordQuarantineObservation } from "./quarantine";
import { checkupAfterSync } from "./checkup";
import { isWriteFailure, storedCoverage } from "./policy-coverage";
import { planPolicies, plannedKey } from "./unifi/plan";
import { planRulePolicies, plannedRuleKey, rulePolicyWrite, type PlannedRulePolicy } from "./unifi/plan-rules";
import { lockDnsExemptionsOf, lockDnsOpenDns } from "./unifi/lock-dns";
import type { UnifiClient } from "./unifi/client";
import type { FirewallPolicy, FirewallPolicyWrite } from "./unifi/types";
import { unrefTimer } from "./unref-timer";

const INTERVAL_MS = 30_000;
// The lock outlives a stalled process by this much, and a running pass renews it well before then:
// one pass of many gateway writes, each allowed 15 seconds, can last minutes.
let lockMs = 25_000;
let lockRenewMs = 8_000;
// Only the latest run is ever read; a week of sync and policy-write history is kept for diagnosis.
const SYNC_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
// A create whose answer was lost has had its policy listed by then if it made one; a gateway that
// keeps answering 5xx would otherwise leave a pending row every pass for a week.
const LOST_CREATE_GRACE_MS = 10 * 60 * 1000;

/**
 * One background queue per process. The route handlers and instrumentation are bundled as
 * separate copies of this module, and each copy starting its own queue let a mutation start a
 * second pump beside the timer's.
 */
const queue: { queued: boolean; pumping: boolean } = ((globalThis as { familyfiReconcileQueue?: { queued: boolean; pumping: boolean } })
  .familyfiReconcileQueue ??= { queued: false, pumping: false });
let autoReconcile = true;
let testClient: UnifiClient | undefined;
let registrantWarning = false;

/** The IEEE registrant for this pass, or the last recorded one when the registry cannot be read. */
function recordedManufacturer(mac: string, previous: string | null): string | null {
  try {
    return macRegistrants().forMac(mac);
  } catch (error) {
    if (!registrantWarning) console.warn("MAC registrant database unavailable:", error);
    registrantWarning = true;
    return previous;
  }
}

export function setReconcileClientForTests(client?: UnifiClient) {
  testClient = client;
}

/** The client a sync pass uses for this household: the test fixture when one is set, behind the same ownership guard. */
export function syncClient(household: Household): UnifiClient {
  return testClient ? withPolicyOwnership(testClient, ownershipScope(household)) : clientForHousehold(household);
}

export function setAutoReconcileForTests(enabled: boolean) {
  autoReconcile = enabled;
}

export function setReconcileLockForTests(timing?: { lockMs: number; renewMs: number }) {
  lockMs = timing?.lockMs ?? 25_000;
  lockRenewMs = timing?.renewMs ?? 8_000;
}

export function requestReconcile() {
  if (!autoReconcile) return;
  queue.queued = true;
  void pump();
}

/** Run one locked reconciliation pass. Used by integration tests. */
export async function runReconcileOnce(): Promise<boolean> {
  const owner = `${process.pid}:${randomToken(8)}`;
  return tick(owner);
}

async function pump() {
  if (queue.pumping) return;
  queue.pumping = true;
  try {
    while (queue.queued) {
      queue.queued = false;
      const owner = `${process.pid}:${randomToken(8)}`;
      try {
        const ran = await tick(owner);
        if (!ran) {
          queue.queued = true;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch {
        queue.queued = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    queue.pumping = false;
    if (queue.queued) void pump();
  }
}

async function acquireLock(owner: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + lockMs);
  const existing = await prisma().reconciliationLock.findUnique({ where: { id: "global" } });
  if (!existing) {
    try {
      await prisma().reconciliationLock.create({ data: { id: "global", owner, expiresAt } });
      return true;
    } catch {
      return false;
    }
  }
  if (existing.owner !== owner && existing.expiresAt > now) return false;
  const updated = await prisma().reconciliationLock.updateMany({
    where: { id: "global", OR: [{ owner }, { expiresAt: { lte: now } }] },
    data: { owner, expiresAt },
  });
  return updated.count === 1;
}

/**
 * Extends the lock this owner still holds. Never takes one that lapsed: another pass may have
 * taken and released it meanwhile, and that pass's writes overlapped this one's.
 */
async function renewLock(owner: string): Promise<boolean> {
  const now = new Date();
  const renewed = await prisma().reconciliationLock.updateMany({
    where: { id: "global", owner, expiresAt: { gt: now } },
    data: { expiresAt: new Date(now.getTime() + lockMs) },
  });
  return renewed.count === 1;
}

async function releaseLock(owner: string) {
  await prisma().reconciliationLock.updateMany({
    where: { id: "global", owner },
    data: { expiresAt: new Date(0) },
  });
}

/** Another owner took the lock while this pass ran: it stops before its next gateway write. */
class LockLostError extends Error {}

/**
 * Keeps a lock just taken for as long as its work runs, however long the gateway takes. A renewal
 * that fails to reach the database is retried on the next beat; one that finds the lock no longer
 * this owner's marks it lost. `release` stops renewing and lets the lock go.
 */
function holdLock(owner: string) {
  let lost = false;
  let renewing: Promise<void> | null = null;
  const renewal = setInterval(() => {
    // One renewal at a time, so the one awaited on release is the only one left to land.
    if (renewing) return;
    renewing = renewLock(owner)
      .then((held) => {
        if (!held) lost = true;
      })
      .catch((error) => console.warn("Reconcile lock renewal failed:", error))
      .finally(() => {
        renewing = null;
      });
  }, lockRenewMs);
  unrefTimer(renewal);
  return {
    lost: () => lost,
    async release() {
      clearInterval(renewal);
      // A renewal still in flight would otherwise take the lock back after it is released.
      await renewing;
      await releaseLock(owner);
    },
  };
}

/**
 * Runs `work` holding the reconcile lock, so no pass writes to the gateway or its policy records
 * meanwhile. Waits up to `waitMs` for a running pass to finish, then gives up with `busy`.
 * `stillHeld` throws once the lock has lapsed, so the work stops before its next write.
 */
export async function withReconcileLock<T>(
  work: (stillHeld: () => void) => Promise<T>,
  options: { waitMs?: number; busy: () => Error },
): Promise<T> {
  const owner = `save:${randomToken(9)}`;
  const deadline = Date.now() + (options.waitMs ?? 60_000);
  while (!(await acquireLock(owner))) {
    if (Date.now() >= deadline) throw options.busy();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const lock = holdLock(owner);
  try {
    return await work(() => {
      if (lock.lost()) throw new LockLostError("A sync took over before the save finished.");
    });
  } finally {
    await lock.release();
  }
}

async function tick(owner: string): Promise<boolean> {
  if (!(await acquireLock(owner))) return false;
  // Best-effort: the flag is read between gateway writes, so one already in flight still finishes.
  const lock = holdLock(owner);
  const stillHeld = () => {
    if (lock.lost()) throw new LockLostError("Another sync took over before this one finished.");
  };
  try {
  const now = new Date();
  // A group's own pause ends: its built-in block rule is switched off, and its policies go.
  await prisma().rule.updateMany({
    where: { systemGroupId: { not: null }, enabled: true, expiresAt: { not: null, lte: now } },
    data: { enabled: false, expiresAt: null, blockedByAccountId: null, blockedByName: null },
  });
  await prisma().rule.updateMany({
    where: { pauseActive: true, pauseUntil: { not: null, lte: now } },
    data: { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null },
  });
  await prisma().ruleGroup.updateMany({
    where: { pauseActive: true, pauseUntil: { not: null, lte: now } },
    data: { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null },
  });

  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household || household.connectionStatus === "unconfigured" || !household.unifiSiteId) return true;

  const revision = household.revision;
  const run = await prisma().syncRun.create({
    data: { requestedRevision: revision, status: ChangeStatus.pending },
  });

  try {
    // Tests inject a fixture client; it gets the same ownership guard as the real one.
    const client = syncClient(household);
    const identity = connectionIdentity(household);
    const siteId = household.unifiSiteId;
    const [zones, networks, clients, gatewayPolicies] = await Promise.all([
      client.listZones(siteId),
      loadNetworkDetails(client, siteId),
      client.listClients(siteId),
      client.listPolicies(siteId),
    ]);
    // Settings reads both from here rather than asking the console on every page refresh.
    rememberSiteNetworks(identity, networks.map(publicUnifiNetwork));
    await recordQuarantineObservation(gatewayPolicies);
    // What the gateway holds right now, kept current as this pass creates and deletes, so a
    // policy someone removed on the console is noticed even when nothing else changed.
    const onGateway = new Set(gatewayPolicies.map((policy) => policy.id));
    // Before planning, so a policy a lost create made is claimed and the orphan sweep removes it.
    // Policies lost creates made: one this pass would create again is taken back instead.
    const adopted = await settleLostCreates({ connectionIdentity: identity, siteId }, gatewayPolicies, {
      abandonBefore: new Date(now.getTime() - LOST_CREATE_GRACE_MS),
    });
    let accessPoints: Map<string, string> | null = null;
    try {
      const siteDevices = await client.listSiteDevices(siteId);
      accessPoints = new Map(siteDevices.map((device) => [device.id, device.name]));
    } catch (error) {
      // Presence remains useful if UniFi cannot name the access points on this pass.
      console.warn("UniFi access point lookup failed:", error);
    }
    const networkClientIds = await loadNetworkClientIds(client, siteId, networks);
    const mappings = mapClientsToZones({ clients, networks, zones, networkClientIds });
    const mappingByMac = new Map(
      mappings.filter((item) => item.macAddress).map((item) => [item.macAddress, item]),
    );
    const external = selectExternalZone(zones);
    if (!external) throw new Error("No External/WAN firewall zone was found.");
    const scope = {
      manageAllNetworks: household.unifiManageAllNetworks,
      managedNetworkIds: household.unifiManagedNetworkIds,
    };

    // One read for every listed client, and writes only for what changed: a pass over hundreds of
    // clients used to be two round trips and a full row rewrite for each.
    const observedMacs = new Set<string>();
    const listed = new Map<string, (typeof clients)[number]>();
    for (const clientRow of clients) {
      if (!clientRow.macAddress) continue;
      const mac = normalizeMac(clientRow.macAddress);
      observedMacs.add(mac);
      listed.set(mac, clientRow);
    }
    const known = new Map(
      (await prisma().device.findMany({ where: { mac: { in: [...listed.keys()] } } })).map((device) => [device.mac, device]),
    );
    const seenMacs: string[] = [];
    for (const [mac, clientRow] of listed) {
      const mapped = mappingByMac.get(mac);
      const existing = known.get(mac);
      const seenOnManagedNetwork = networkInScope(scope, mapped?.networkId ?? null);
      if (!existing && !seenOnManagedNetwork) continue;
      const connectionType = ["WIRED", "WIRELESS", "VPN", "TELEPORT"].includes(clientRow.type)
        ? clientRow.type.toLowerCase()
        : null;
      const connectedAt = clientRow.connectedAt && !Number.isNaN(Date.parse(clientRow.connectedAt))
        ? new Date(clientRow.connectedAt)
        : null;
      const accessPointName = connectionType === "wireless" && clientRow.uplinkDeviceId
        ? accessPoints === null
          ? existing?.accessPointName ?? null
          : accessPoints.get(clientRow.uplinkDeviceId) ?? null
        : null;
      const observed = {
        hostname: clientRow.name,
        ip: clientRow.ipAddress,
        networkId: mapped?.networkId ?? existing?.networkId ?? null,
        zoneId: mapped?.sourceZoneId ?? existing?.zoneId ?? null,
        connectedAt,
        connectionType,
        accessPointName,
        manufacturer: recordedManufacturer(mac, existing?.manufacturer ?? null),
      };
      // Upserted and updated by MAC, so a device deleted or imported since the read above
      // neither fails the pass nor is written twice.
      if (!existing) {
        await prisma().device.upsert({
          where: { mac },
          create: {
            mac,
            ...observed,
            assignment: AssignmentState.quarantined,
            lastSeenAt: now,
            presenceOnline: true,
            presenceCheckedAt: now,
          },
          update: { ...observed, lastSeenAt: now, presenceOnline: true, presenceCheckedAt: now },
        });
        continue;
      }
      seenMacs.push(mac);
      // A field the gateway left out (undefined) keeps what is stored, as Prisma reads it.
      const changed = Object.entries(observed).filter(
        ([field, value]) => value !== undefined && !isDeepStrictEqual(value, existing[field as keyof typeof observed]),
      );
      if (changed.length) await prisma().device.updateMany({ where: { mac }, data: Object.fromEntries(changed) });
    }
    await prisma().device.updateMany({
      where: { mac: { in: seenMacs } },
      data: { lastSeenAt: now, presenceOnline: true, presenceCheckedAt: now },
    });
    // Only devices going offline now: one already offline stays as it was, and the household's
    // presenceCheckedAt below says it was checked.
    await prisma().device.updateMany({
      where: { mac: { notIn: [...observedMacs] }, OR: [{ presenceOnline: true }, { presenceOnline: null }] },
      data: {
        presenceOnline: false,
        presenceCheckedAt: now,
        connectedAt: null,
        connectionType: null,
        accessPointName: null,
      },
    });
    await prisma().household.update({ where: { id: "default" }, data: { presenceCheckedAt: now } });

    const [groups, devices, appPolicies, quarantinePauses] = await Promise.all([
      prisma().group.findMany(),
      prisma().device.findMany(),
      prisma().appPolicy.findMany({ where: { connectionIdentity: identity, siteId } }),
      // A pause on the built-in quarantine rule disables its policies, which keep their devices.
      prisma().rule.count({
        where: { id: QUARANTINE_RULE_ID, pauseActive: true, OR: [{ pauseUntil: null }, { pauseUntil: { gt: now } }] },
      }),
    ]);
    const quarantinePaused = quarantinePauses > 0;
    const { policies: desired, retainOwners } = planPolicies({
      installId: household.id,
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups,
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      quarantineEnforced: household.quarantineEnforced && !quarantinePaused,
    });
    const desiredKeys = new Set(desired.map((item) => item.key));

    let failed = 0;
    const errors: string[] = [];

    for (const planned of desired) {
      stillHeld();
      const write = internetBlockPolicy({
        name: planned.name,
        sourceZoneId: planned.zoneId,
        destinationZoneId: planned.destinationZoneId,
        macAddresses: planned.macAddresses,
        enabled: planned.enabled,
      });
      const fingerprint = policyFingerprint(write);
      const existing = appPolicies.find(
        (row) =>
          plannedKey(row.ownerScope, row.groupId, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredPolicy(client, siteId, identity, revision, planned, write, fingerprint, existing, onGateway, adopted);
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        if (existing) {
          await prisma().appPolicy.update({
            where: { id: existing.id },
            data: { lastError: errors[errors.length - 1], desiredFingerprint: fingerprint, desiredRevision: revision },
          });
        } else {
          await prisma().appPolicy.create({
            data: {
              connectionIdentity: identity,
              siteId,
              ownerScope: planned.ownerScope === "group" ? PolicyOwnerScope.group : PolicyOwnerScope.quarantine,
              groupId: planned.groupId,
              zoneId: planned.zoneId,
              ipVersion: IpVersion.dual,
              desiredFingerprint: fingerprint,
              desiredRevision: revision,
              lastError: errors[errors.length - 1],
            },
          });
        }
      }
    }

    for (const row of appPolicies) {
      stillHeld();
      const key = plannedKey(row.ownerScope, row.groupId, row.zoneId);
      if (desiredKeys.has(key)) continue;
      const owner = row.ownerScope === PolicyOwnerScope.quarantine ? "quarantine" : `group:${row.groupId}`;
      // Kept while its devices are out of view, unless the console already removed it.
      if (retainOwners.has(owner) && !goneFromGateway(row.unifiPolicyId, onGateway)) continue;
      if (!row.unifiPolicyId) {
        await prisma().appPolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        await deleteFromGateway(client, siteId, row.unifiPolicyId, onGateway);
        await prisma().appPolicy.delete({ where: { id: row.id } });
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        await prisma().appPolicy.update({
          where: { id: row.id },
          data: { lastError: errors[errors.length - 1] },
        });
      }
    }

    // The built-in quarantine rule is enforced by the quarantine policies above, never its own.
    const rules = await prisma().rule.findMany({ where: { id: { not: QUARANTINE_RULE_ID } }, include: { groups: true, windows: true } });
    const rulePolicies = await prisma().rulePolicy.findMany({
      where: { connectionIdentity: identity, siteId },
    });
    // Lock DNS leaves the household's own DNS alone: the resolvers of the household and of the
    // groups it covers (on whole networks, the groups with a device on them), looked up only while
    // it covers something. When that cannot be worked out this pass, its policies stay as they are.
    const lockDnsRule = rules.find((rule) => rule.id === LOCK_DNS_RULE_ID);
    const lockDnsNetworks = lockDnsRule?.scope === RuleScope.network ? new Set(lockDnsRule.networkIds) : null;
    const lockDnsGroups = new Set(
      lockDnsNetworks
        ? devices.flatMap((device) => (device.groupId && device.networkId && lockDnsNetworks.has(device.networkId) ? [device.groupId] : []))
        : lockDnsRule?.groups.map((link) => link.groupId),
    );
    const lockDnsOpen = (lockDnsNetworks ? lockDnsNetworks.size : lockDnsGroups.size)
      ? await lockDnsOpenDns({
          networks: networks.filter((network) => networkInScope(scope, network.id)),
          resolvers: [
            { source: "household", name: null, url: household.dohUrl },
            ...groups.filter((group) => lockDnsGroups.has(group.id)).map((group) => ({ source: "group" as const, name: group.name, url: group.dohOverrideUrl })),
          ],
        })
      : [];
    const lockDnsExempt = lockDnsOpen && (lockDnsOpen.length ? lockDnsExemptionsOf(lockDnsOpen) : undefined);
    // Its page shows what it left open; a pass that could not tell keeps the last answer.
    // Compared as values: JSONB keeps an object's keys in its own order.
    if (lockDnsRule && lockDnsOpen && !isDeepStrictEqual(lockDnsRule.openDns, lockDnsOpen))
      await prisma().rule.update({ where: { id: LOCK_DNS_RULE_ID }, data: { openDns: lockDnsOpen } });
    const rulePlan = planRulePolicies({
      destinationZoneId: external.id,
      zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
      groups: groups.map((group) => ({
        id: group.id,
        kind: group.kind,
      })),
      devices: devices.map((device) => ({
        ...device,
        inScope: networkInScope(scope, device.networkId),
      })),
      networks: networks.map((network) => ({
        id: network.id,
        name: network.name,
        zoneId: network.zoneId ?? null,
      })),
      networkScope: scope,
      lockDnsExemptions: lockDnsExempt ?? undefined,
      rules: rules.filter((rule) => !(rule.id === LOCK_DNS_RULE_ID && lockDnsExempt === null)).map((rule) => ({
        ...rule,
        groupIds: rule.groups.map((link) => link.groupId),
        paused: isSuspended({ active: rule.pauseActive, until: rule.pauseUntil }, now),
        system: rule.systemGroupId !== null,
        liftedGroupIds: rule.groups
          .filter((link) => isSuspended({ active: link.pauseActive, until: link.pauseUntil }, now))
          .map((link) => link.groupId),
      })),
    });
    const { policies: desiredRules, retainRuleIds, orphanRuleIds } = rulePlan;
    if (lockDnsExempt === null) {
      retainRuleIds.add(LOCK_DNS_RULE_ID);
      // Not applied: the pass is partial, and the next one tries again.
      failed += 1;
      errors.push("Lock DNS kept as it was: a network's DNS settings could not be read.");
    }
    const desiredRuleKeys = new Set(desiredRules.map((item) => item.key));

    for (const planned of desiredRules) {
      stillHeld();
      const write = rulePolicyWrite(planned);
      const fingerprint = policyFingerprint(write);
      const existing = rulePolicies.find(
        (row) => plannedRuleKey(row.ruleId, row.windowKey, row.zoneId) === planned.key && row.connectionIdentity === identity,
      );
      try {
        await applyDesiredRulePolicy(client, siteId, identity, revision, planned, write, fingerprint, existing, onGateway, adopted);
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        if (existing) {
          await prisma().rulePolicy.update({
            where: { id: existing.id },
            data: { lastError: errors[errors.length - 1], desiredFingerprint: fingerprint, desiredRevision: revision },
          });
        } else {
          await prisma().rulePolicy.create({
            data: {
              ruleId: planned.ruleId,
              windowKey: planned.windowKey,
              connectionIdentity: identity,
              siteId,
              zoneId: planned.zoneId,
              ipVersion: IpVersion.dual,
              desiredFingerprint: fingerprint,
              desiredRevision: revision,
              lastError: errors[errors.length - 1],
            },
          });
        }
      }
    }

    for (const row of rulePolicies) {
      stillHeld();
      const key = plannedRuleKey(row.ruleId, row.windowKey, row.zoneId);
      if (desiredRuleKeys.has(key)) continue;
      if (retainRuleIds.has(row.ruleId) && !goneFromGateway(row.unifiPolicyId, onGateway)) continue;
      if (!row.unifiPolicyId) {
        await prisma().rulePolicy.delete({ where: { id: row.id } });
        continue;
      }
      try {
        // D3: only delete the recorded unifiPolicyId — never adopt by name prefix.
        await deleteFromGateway(client, siteId, row.unifiPolicyId, onGateway);
        await prisma().rulePolicy.delete({ where: { id: row.id } });
      } catch (error) {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
        await prisma().rulePolicy.update({
          where: { id: row.id },
          data: { lastError: errors[errors.length - 1] },
        });
      }
    }

    // Sync cleanup: network rules with no remaining managed network ids leave no silent orphans.
    for (const orphanId of orphanRuleIds) {
      const remaining = await prisma().rulePolicy.count({ where: { ruleId: orphanId } });
      if (remaining === 0) {
        await prisma().rule.delete({ where: { id: orphanId } }).catch(() => undefined);
      }
    }

    const orphanErrors = await removeOrphanedPolicies(client, siteId, identity, onGateway, stillHeld);
    failed += orphanErrors.length;
    errors.push(...orphanErrors);

    const { issues } = await storedCoverage({
      now,
      deviceInScope: (networkId) => networkInScope(scope, networkId),
      policyScope: { connectionIdentity: identity, siteId },
    });
    for (const issue of issues.filter(isWriteFailure)) {
      failed += 1;
      errors.push(issue.message);
    }

    const status = failed === 0 ? ChangeStatus.applied : ChangeStatus.partial;
    // The pass that took over settles the pending changes against what it wrote.
    stillHeld();
    await prisma().syncRun.update({
      where: { id: run.id },
      data: {
        status,
        appliedRevision: revision,
        finishedAt: new Date(),
        error: errors[0],
      },
    });
    // The pass reached the gateway, so an error left by an earlier failed pass no longer holds.
    await prisma().household.updateMany({
      where: { id: "default", connectionStatus: "error" },
      data: { connectionStatus: "connected", connectionError: null },
    });
    await prisma().changeResult.updateMany({
      where: { status: ChangeStatus.pending, requestedRevision: { lte: revision } },
      data: {
        status,
        appliedRevision: revision,
        error: errors[0],
        syncRunId: run.id,
      },
    });
    // The checkup reads what this pass read, at most once an interval; it never fails the pass.
    stillHeld();
    await checkupAfterSync(household, client, { zones, networks, clients, networkClientIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma().syncRun.update({
      where: { id: run.id },
      data: { status: ChangeStatus.failed, finishedAt: new Date(), error: message },
    });
    // Not the gateway's fault, and the pass that took over settles the pending changes.
    if (error instanceof LockLostError || lock.lost()) return true;
    await prisma().household.update({
      where: { id: "default" },
      data: { connectionStatus: "error", connectionError: message },
    });
    await prisma().changeResult.updateMany({
      where: { status: ChangeStatus.pending, requestedRevision: { lte: revision } },
      data: { status: ChangeStatus.failed, error: message, syncRunId: run.id },
    });
  }
  // The pass that took over prunes; this one may no longer hold the lock.
  if (lock.lost()) return true;
  // A run every interval adds up to a million rows a year; the change results they settled keep their outcome.
  await prisma().syncRun.deleteMany({
    where: { id: { not: run.id }, startedAt: { lt: new Date(now.getTime() - SYNC_HISTORY_MS) } },
  });
  // Creates that failed or whose policy is gone prove nothing. Applied ones are the evidence the
  // ownership guard reads, and pending ones may still find their policy, so both stay.
  await prisma().policyOperation.deleteMany({
    where: { status: { in: ["failed", "removed"] }, updatedAt: { lt: new Date(now.getTime() - SYNC_HISTORY_MS) } },
  });
  return true;
  } finally {
    await lock.release();
  }
}

async function applyDesiredPolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  revision: number,
  planned: { ownerScope: "group" | "quarantine"; groupId: string | null; zoneId: string; name: string },
  write: FirewallPolicyWrite,
  fingerprint: string,
  existing:
    | {
        id: string;
        unifiPolicyId: string | null;
        desiredFingerprint: string;
        observedFingerprint: string | null;
        lastError: string | null;
      }
    | undefined,
  onGateway: Set<string>,
  adopted: FirewallPolicy[],
) {
  const scope = planned.ownerScope === "group" ? PolicyOwnerScope.group : PolicyOwnerScope.quarantine;
  const appPolicyId = existing?.id;
  const unifiPolicyId = existing?.unifiPolicyId;
  // Unchanged and still on the gateway: nothing to write. A policy removed on the console
  // falls through and is created again below.
  if (
    existing &&
    unifiPolicyId &&
    onGateway.has(unifiPolicyId) &&
    existing.desiredFingerprint === fingerprint &&
    !existing.lastError
  ) {
    // Recorded once when it was last confirmed, not rewritten every pass.
    if (existing.observedFingerprint !== fingerprint) {
      await prisma().appPolicy.update({
        where: { id: existing.id },
        data: { desiredRevision: revision, observedFingerprint: fingerprint },
      });
    }
    return;
  }
  if (unifiPolicyId && onGateway.has(unifiPolicyId)) {
    try {
      const current = await client.getPolicy(siteId, unifiPolicyId);
      const updated = await client.updatePolicy(siteId, unifiPolicyId, toPolicyUpdate(current, { ...write, schedule: write.schedule ?? null }));
      const observed = {
        unifiPolicyId: updated.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: updated.enabled,
        observedFingerprint: fingerprint,
        lastError: null as string | null,
      };
      if (appPolicyId) {
        await prisma().appPolicy.update({ where: { id: appPolicyId }, data: observed });
      } else {
        await prisma().appPolicy.create({
          data: {
            connectionIdentity: identity,
            siteId,
            ownerScope: scope,
            groupId: planned.groupId,
            zoneId: planned.zoneId,
            ipVersion: IpVersion.dual,
            ...observed,
          },
        });
      }
      return;
    } catch (error) {
      if (!(error instanceof UnifiHttpError) || error.status !== 404) throw error;
    }
  }

  const created = await createOwnedPolicy(client, siteId, identity, write, fingerprint, onGateway, adopted);
  if (appPolicyId) {
    await prisma().appPolicy.update({
      where: { id: appPolicyId },
      data: {
        unifiPolicyId: created.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: created.enabled,
        observedFingerprint: fingerprint,
        lastError: null,
      },
    });
    return;
  }
  await prisma().appPolicy.create({
    data: {
      connectionIdentity: identity,
      siteId,
      unifiPolicyId: created.id,
      ownerScope: scope,
      groupId: planned.groupId,
      zoneId: planned.zoneId,
      ipVersion: IpVersion.dual,
      desiredFingerprint: fingerprint,
      desiredRevision: revision,
      observedEnabled: created.enabled,
      observedFingerprint: fingerprint,
    },
  });
}


async function applyDesiredRulePolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  revision: number,
  planned: PlannedRulePolicy,
  write: FirewallPolicyWrite,
  fingerprint: string,
  existing:
    | {
        id: string;
        unifiPolicyId: string | null;
        desiredFingerprint: string;
        observedFingerprint: string | null;
        lastError: string | null;
      }
    | undefined,
  onGateway: Set<string>,
  adopted: FirewallPolicy[],
) {
  const unifiPolicyId = existing?.unifiPolicyId;
  // Unchanged and still on the gateway: nothing to write. A policy removed on the console
  // falls through and is created again below.
  if (
    existing &&
    unifiPolicyId &&
    onGateway.has(unifiPolicyId) &&
    existing.desiredFingerprint === fingerprint &&
    !existing.lastError
  ) {
    // Recorded once when it was last confirmed, not rewritten every pass.
    if (existing.observedFingerprint !== fingerprint) {
      await prisma().rulePolicy.update({
        where: { id: existing.id },
        data: { desiredRevision: revision, observedFingerprint: fingerprint },
      });
    }
    return;
  }
  if (unifiPolicyId && onGateway.has(unifiPolicyId)) {
    try {
      // D3: update only the recorded id — never search/adopt by FamilyFi name prefix.
      const current = await client.getPolicy(siteId, unifiPolicyId);
      const updated = await client.updatePolicy(
        siteId,
        unifiPolicyId,
        toPolicyUpdate(current, { ...write, schedule: write.schedule ?? null }),
      );
      const observed = {
        unifiPolicyId: updated.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: updated.enabled,
        observedFingerprint: fingerprint,
        lastError: null as string | null,
      };
      if (existing) {
        await prisma().rulePolicy.update({ where: { id: existing.id }, data: observed });
      } else {
        await prisma().rulePolicy.create({
          data: {
            ruleId: planned.ruleId,
            windowKey: planned.windowKey,
            connectionIdentity: identity,
            siteId,
            zoneId: planned.zoneId,
            ipVersion: IpVersion.dual,
            ...observed,
          },
        });
      }
      return;
    } catch (error) {
      if (!(error instanceof UnifiHttpError) || error.status !== 404) throw error;
    }
  }

  const created = await createOwnedPolicy(client, siteId, identity, write, fingerprint, onGateway, adopted);
  if (existing) {
    await prisma().rulePolicy.update({
      where: { id: existing.id },
      data: {
        unifiPolicyId: created.id,
        desiredFingerprint: fingerprint,
        desiredRevision: revision,
        observedEnabled: created.enabled,
        observedFingerprint: fingerprint,
        lastError: null,
      },
    });
    return;
  }
  await prisma().rulePolicy.create({
    data: {
      ruleId: planned.ruleId,
      windowKey: planned.windowKey,
      connectionIdentity: identity,
      siteId,
      unifiPolicyId: created.id,
      zoneId: planned.zoneId,
      ipVersion: IpVersion.dual,
      desiredFingerprint: fingerprint,
      desiredRevision: revision,
      observedEnabled: created.enabled,
      observedFingerprint: fingerprint,
    },
  });
}

/**
 * Creates a policy and records the creation, which is the evidence it is ours. A create the
 * gateway refused is marked failed, so a policy it keeps refusing leaves no open operation behind;
 * one whose answer was lost stays pending until the next pass finds its policy.
 */
async function createOwnedPolicy(
  client: UnifiClient,
  siteId: string,
  identity: string,
  write: FirewallPolicyWrite,
  fingerprint: string,
  onGateway: Set<string>,
  adopted: FirewallPolicy[],
) {
  // A lost create already made this very policy: record it rather than make a second, which
  // would leave the sweep deleting the one that works if this create failed.
  const reclaimed = adopted.findIndex((policy) => reclaims(policy, write));
  if (reclaimed >= 0) return adopted.splice(reclaimed, 1)[0];
  const operation = await prisma().policyOperation.create({
    data: {
      intent: PolicyOperationIntent.create,
      connectionIdentity: identity,
      siteId,
      payloadFingerprint: fingerprint,
      payload: write as Prisma.InputJsonValue,
      status: "pending",
    },
  });
  let created: Awaited<ReturnType<UnifiClient["createPolicy"]>>;
  try {
    created = await client.createPolicy(siteId, write);
  } catch (error) {
    // Only a refusal is known to have created nothing. A lost answer, or a 5xx a proxy may have
    // sent after the gateway committed the create, stays pending.
    if (error instanceof UnifiHttpError && error.status >= 400 && error.status < 500) {
      await prisma().policyOperation.update({ where: { id: operation.id }, data: { status: "failed", payload: Prisma.DbNull } });
    }
    throw error;
  }
  onGateway.add(created.id);
  await prisma().policyOperation.update({
    where: { id: operation.id },
    data: { status: "applied", unifiPolicyId: created.id, payload: Prisma.DbNull },
  });
  return created;
}

export function startReconciliation() {
  env();
  requestReconcile();
  const timer = setInterval(() => requestReconcile(), INTERVAL_MS);
  unrefTimer(timer);
}

function isNotFound(error: unknown): boolean {
  return error instanceof UnifiHttpError && error.status === 404;
}

/** A record whose policy is no longer on the gateway: there is nothing left to keep. */
function goneFromGateway(unifiPolicyId: string | null, onGateway: Set<string>): boolean {
  return Boolean(unifiPolicyId) && !onGateway.has(unifiPolicyId!);
}

/** Deletes a policy FamilyFi owns. One already gone from the gateway counts as deleted. */
async function deleteFromGateway(client: UnifiClient, siteId: string, policyId: string, onGateway: Set<string>) {
  if (onGateway.has(policyId)) {
    try {
      await client.deletePolicy(siteId, policyId);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  onGateway.delete(policyId);
}

/**
 * Deletes policies FamilyFi created on this console and site that no ownership record
 * points at any more. A rule, group or console change drops its records even when the
 * UniFi delete failed, which used to leave the policy enforcing on the gateway with
 * nothing to clean it up. The creation record is the evidence it is ours, never its name.
 */
async function removeOrphanedPolicies(
  client: UnifiClient,
  siteId: string,
  identity: string,
  onGateway: Set<string>,
  stillHeld: () => void,
): Promise<string[]> {
  const scope = { connectionIdentity: identity, siteId };
  const [appPolicies, rulePolicies, creations] = await Promise.all([
    prisma().appPolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().rulePolicy.findMany({ where: scope, select: { unifiPolicyId: true } }),
    prisma().policyOperation.findMany({
      where: { ...scope, intent: PolicyOperationIntent.create, status: "applied", unifiPolicyId: { not: null } },
    }),
  ]);
  const recorded = new Set([...appPolicies, ...rulePolicies].map((row) => row.unifiPolicyId));
  const errors: string[] = [];
  for (const creation of creations) {
    const policyId = creation.unifiPolicyId!;
    if (recorded.has(policyId)) continue;
    stillHeld();
    try {
      await deleteFromGateway(client, siteId, policyId, onGateway);
      // Gone from the gateway and from the records: no longer evidence of anything.
      await prisma().policyOperation.update({ where: { id: creation.id }, data: { status: "removed" } });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
