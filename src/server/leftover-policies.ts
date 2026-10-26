import { PolicyOperationIntent, type Household } from "@prisma/client";
import { leftoverPolicies, type CheckupPolicy, type CheckupPolicyBlocks } from "@/lib/checkup";
import { prisma } from "./db";
import type { UnifiClient } from "./unifi/client";
import { ownershipScope } from "./unifi/connection";
import { UnifiHttpError } from "./unifi/errors";
import { carriesWrite } from "./unifi/lost-creates";
import { selectExternalZone } from "./unifi/mapping";
import type { OwnershipScope } from "./unifi/policy-ownership";
import type { FirewallPolicy, FirewallZone } from "./unifi/types";

/**
 * Leftover policies: firewall policies on the gateway named with FamilyFi's prefix that no
 * FamilyFi record claims, most often left by an earlier install or a reset database. Checkup
 * lists them; FamilyFi deletes one only when an administrator ticks it and confirms, and records
 * that confirmation before the delete so the ownership guard lets that one delete through.
 */

/**
 * The gateway's user-made policies that no FamilyFi record claims for this console and site.
 * A policy a pending create may have made is left out: its answer may just not be back yet.
 */
export async function unrecordedPolicies(scope: OwnershipScope & { siteId: string }, gatewayPolicies: FirewallPolicy[]): Promise<FirewallPolicy[]> {
  const where = { connectionIdentity: scope.connectionIdentity, siteId: scope.siteId };
  const [appPolicies, rulePolicies, operations] = await Promise.all([
    prisma().appPolicy.findMany({ where, select: { unifiPolicyId: true } }),
    prisma().rulePolicy.findMany({ where, select: { unifiPolicyId: true } }),
    prisma().policyOperation.findMany({
      where: { ...where, intent: PolicyOperationIntent.create, status: { in: ["applied", "pending"] } },
      select: { status: true, unifiPolicyId: true, payload: true },
    }),
  ]);
  const claimed = new Set([...appPolicies, ...rulePolicies, ...operations.filter((row) => row.status === "applied")].map((row) => row.unifiPolicyId));
  const pending = operations.filter((row) => row.status === "pending" && row.payload).map((row) => row.payload);
  return gatewayPolicies.filter(
    (policy) => policy.metadata?.origin !== "SYSTEM_DEFINED" && !claimed.has(policy.id) && !pending.some((payload) => carriesWrite(policy, payload)),
  );
}

const BLOCKS: Record<string, CheckupPolicyBlocks> = {
  APPLICATION_CATEGORY: "categories",
  APPLICATION: "apps",
  DOMAIN: "websites",
  REGION: "countries",
};

/** A policy as Checkup describes it. */
export function checkupPolicy(policy: FirewallPolicy, zones: FirewallZone[]): CheckupPolicy {
  const filter = policy.destination?.trafficFilter;
  const internet = !filter && policy.destination?.zoneId === selectExternalZone(zones)?.id;
  const macs = policy.source?.trafficFilter?.macAddressFilter?.macAddresses;
  return {
    id: policy.id,
    name: policy.name,
    enabled: policy.enabled,
    blocks: policy.action?.type !== "ALLOW",
    what: internet ? "internet" : (filter && BLOCKS[filter.type]) || "traffic",
    devices: macs ? macs.length : null,
    scheduled: Boolean(policy.schedule),
  };
}

export type LeftoverRemovalResult = { removed: string[]; skipped: string[] };

/**
 * Deletes the leftover policies an administrator confirmed. Each id is checked again against the
 * gateway as it is now: still there, still named like FamilyFi's, still claimed by no record.
 * Anything else is skipped, never deleted. The confirmation is recorded first, so the ownership
 * guard on `client` lets this delete, and only this one, through.
 */
export async function removeLeftoverPolicies(household: Household, client: UnifiClient, policyIds: string[]): Promise<LeftoverRemovalResult> {
  const siteId = household.unifiSiteId!;
  const scope = { connectionIdentity: ownershipScope(household).connectionIdentity, siteId };
  const leftovers = new Map(leftoverPolicies(await unrecordedPolicies(scope, await client.listPolicies(siteId))).map((policy) => [policy.id, policy]));
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const policyId of new Set(policyIds)) {
    const policy = leftovers.get(policyId);
    if (!policy) {
      skipped.push(policyId);
      continue;
    }
    const operation = await prisma().policyOperation.create({
      data: { intent: PolicyOperationIntent.delete, status: "confirmed", unifiPolicyId: policyId, payload: { name: policy.name }, ...scope },
    });
    try {
      await client.deletePolicy(siteId, policyId);
    } catch (error) {
      if (!(error instanceof UnifiHttpError && error.status === 404)) {
        await prisma().policyOperation.update({ where: { id: operation.id }, data: { status: "failed" } });
        throw error;
      }
    }
    // Gone: no longer a confirmation, so nothing can use it to delete again, and sync prunes it.
    await prisma().policyOperation.update({ where: { id: operation.id }, data: { status: "removed" } });
    removed.push(policyId);
  }
  return { removed, skipped };
}
