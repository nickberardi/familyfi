import { PolicyOwnerScope } from "@prisma/client";
import { prisma } from "./db";

export function quarantineBlockingFromLive(policies: { enabled: boolean }[]): boolean {
  return policies.some((policy) => policy.enabled);
}

/**
 * Records whether each quarantine policy is enabled on the gateway, from the policy list a
 * reconcile pass has already read, so Settings never has to ask the console itself. A
 * policy missing from the gateway is unknown (null) until the pass puts it back.
 */
export async function recordQuarantineObservation(livePolicies: { id: string; enabled: boolean }[]): Promise<void> {
  const rows = await prisma().appPolicy.findMany({
    where: { ownerScope: PolicyOwnerScope.quarantine, unifiPolicyId: { not: null } },
    select: { id: true, unifiPolicyId: true, observedEnabled: true },
  });
  const byId = new Map(livePolicies.map((policy) => [policy.id, policy.enabled]));
  for (const row of rows) {
    const observed = byId.get(row.unifiPolicyId!) ?? null;
    if (observed === row.observedEnabled) continue;
    await prisma().appPolicy.update({ where: { id: row.id }, data: { observedEnabled: observed } });
  }
}

/** Whether quarantine is blocking, as the last reconcile pass saw the gateway. */
export async function storedQuarantineBlocking(): Promise<{
  observedEnabled: boolean | null;
  policyCount: number;
}> {
  const rows = await prisma().appPolicy.findMany({
    where: { ownerScope: PolicyOwnerScope.quarantine, unifiPolicyId: { not: null } },
    select: { observedEnabled: true },
  });
  if (rows.length === 0) return { observedEnabled: false, policyCount: 0 };
  const known = rows.flatMap((row) => (row.observedEnabled === null ? [] : [{ enabled: row.observedEnabled }]));
  if (known.length === 0) return { observedEnabled: null, policyCount: rows.length };
  return { observedEnabled: quarantineBlockingFromLive(known), policyCount: known.length };
}
