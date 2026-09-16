import { FamRuleScope } from "@prisma/client";
import { prisma } from "./db";
import { clientForHousehold, connectionIdentity } from "./unifi/connection";
import { networkInScope, type NetworkScope } from "./unifi/scope";

/**
 * Settings descope: strip unmanaged network ids from network-scoped Fam rules.
 * Rules left with zero managed network ids are deleted (including recorded UniFi policies — D3).
 * Returns counts for tests / callers.
 */
export async function pruneNetworkScopedRulesForScope(scope: NetworkScope): Promise<{
  pruned: number;
  deleted: number;
}> {
  const rules = await prisma().famRule.findMany({ where: { scope: FamRuleScope.network } });
  let pruned = 0;
  let deleted = 0;
  for (const rule of rules) {
    const previous = [...new Set(rule.networkIds)].sort();
    const kept = previous.filter((id) => networkInScope(scope, id));
    if (kept.length === previous.length) {
      continue;
    }
    if (kept.length === 0) {
      await deleteNetworkFamRule(rule.id);
      deleted += 1;
      continue;
    }
    await prisma().famRule.update({ where: { id: rule.id }, data: { networkIds: kept } });
    pruned += 1;
  }
  return { pruned, deleted };
}

async function deleteNetworkFamRule(id: string) {
  const existing = await prisma().famRule.findUnique({
    where: { id },
    include: { policies: true },
  });
  if (!existing) return;
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (household && household.connectionStatus !== "unconfigured" && household.unifiSiteId) {
    try {
      const client = clientForHousehold(household);
      const identity = connectionIdentity(household);
      for (const policy of existing.policies) {
        if (policy.connectionIdentity !== identity || policy.siteId !== household.unifiSiteId) continue;
        if (!policy.unifiPolicyId) continue;
        try {
          await client.deletePolicy(household.unifiSiteId, policy.unifiPolicyId);
        } catch {
          // Desired-state delete still proceeds; Sync surfaces connection errors.
        }
      }
    } catch {
      // Proceed with desired-state cleanup.
    }
  }
  await prisma().famRulePolicy.deleteMany({ where: { famRuleId: id } });
  await prisma().famRule.delete({ where: { id } });
}
