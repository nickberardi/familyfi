import { PolicyOwnerScope, type Household } from "@prisma/client";
import { prisma } from "./db";
import { clientForHousehold } from "./unifi/connection";

export function quarantineBlockingFromLive(policies: { enabled: boolean }[]): boolean {
  return policies.some((policy) => policy.enabled);
}

export async function observeQuarantineBlocking(household: Household): Promise<{
  observedEnabled: boolean | null;
  policyCount: number;
}> {
  const rows = await prisma().appPolicy.findMany({
    where: { ownerScope: PolicyOwnerScope.quarantine, unifiPolicyId: { not: null } },
    select: { id: true, unifiPolicyId: true, observedEnabled: true },
  });
  if (rows.length === 0) return { observedEnabled: false, policyCount: 0 };
  if (!household.unifiSiteId || !household.unifiKeyLastFour) {
    return {
      observedEnabled: rows.some((row) => row.observedEnabled === true),
      policyCount: rows.length,
    };
  }
  try {
    const client = clientForHousehold(household);
    const live = await client.listPolicies(household.unifiSiteId);
    const byId = new Map(live.map((policy) => [policy.id, policy]));
    const matched: { enabled: boolean }[] = [];
    for (const row of rows) {
      const policy = row.unifiPolicyId ? byId.get(row.unifiPolicyId) : undefined;
      if (!policy) continue;
      matched.push(policy);
      await prisma().appPolicy.update({
        where: { id: row.id },
        data: { observedEnabled: policy.enabled },
      });
    }
    if (matched.length === 0) return { observedEnabled: null, policyCount: rows.length };
    return { observedEnabled: quarantineBlockingFromLive(matched), policyCount: matched.length };
  } catch {
    const known = rows.filter((row) => row.observedEnabled !== null);
    if (known.length === 0) return { observedEnabled: null, policyCount: rows.length };
    return {
      observedEnabled: known.some((row) => row.observedEnabled === true),
      policyCount: known.length,
    };
  }
}
