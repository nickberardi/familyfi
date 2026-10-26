import { PolicyOperationIntent, Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { OwnershipScope } from "./policy-ownership";
import type { FirewallPolicy } from "./types";

/**
 * Whether `actual` holds everything `expected` sent. The gateway answers with its own key order,
 * its own order for lists such as MAC addresses, and defaults the write left out, so a policy
 * carries a write when every field the write set is there with the same value, wherever it sits.
 */
export function carriesWrite(actual: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    const left = [...actual];
    return expected.every((item) => {
      const index = left.findIndex((candidate) => carriesWrite(candidate, item));
      if (index < 0) return false;
      left.splice(index, 1);
      return true;
    });
  }
  if (typeof expected === "object") {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    return Object.entries(expected).every(
      ([key, value]) => value === undefined || carriesWrite((actual as Record<string, unknown>)[key], value),
    );
  }
  return actual === expected;
}

/**
 * Finds the policies that creates whose answer was lost made. A pending create is matched to a
 * policy on the gateway that no record claims and that carries the whole write it sent; that
 * policy is recorded as the create's, so the orphan sweep removes it like any other unclaimed
 * one. Never by name alone: the evidence is our own creation record plus the whole payload. A
 * create still unmatched and older than `abandonBefore` made nothing, and is marked failed. Returns
 * the policies matched, which a pass about to create the same write records instead.
 */
export async function settleLostCreates(
  scope: OwnershipScope & { siteId: string },
  gatewayPolicies: FirewallPolicy[],
  options: { abandonBefore: Date },
): Promise<FirewallPolicy[]> {
  const where = { connectionIdentity: scope.connectionIdentity, siteId: scope.siteId };
  const pending = await prisma().policyOperation.findMany({
    where: { ...where, intent: PolicyOperationIntent.create, status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return [];
  const [appPolicies, rulePolicies, creations] = await Promise.all([
    prisma().appPolicy.findMany({ where, select: { unifiPolicyId: true } }),
    prisma().rulePolicy.findMany({ where, select: { unifiPolicyId: true } }),
    prisma().policyOperation.findMany({
      where: { ...where, intent: PolicyOperationIntent.create, status: "applied" },
      select: { unifiPolicyId: true },
    }),
  ]);
  const claimed = new Set([...appPolicies, ...rulePolicies, ...creations].map((row) => row.unifiPolicyId));
  const unclaimed = gatewayPolicies.filter((policy) => !claimed.has(policy.id));
  const matched: FirewallPolicy[] = [];
  for (const operation of pending) {
    const match = operation.payload
      ? unclaimed.find((policy) => !claimed.has(policy.id) && carriesWrite(policy, operation.payload))
      : undefined;
    if (match) {
      claimed.add(match.id);
      matched.push(match);
      await prisma().policyOperation.update({
        where: { id: operation.id },
        data: { status: "applied", unifiPolicyId: match.id, payload: Prisma.DbNull },
      });
    } else if (operation.createdAt < options.abandonBefore) {
      await prisma().policyOperation.update({ where: { id: operation.id }, data: { status: "failed", payload: Prisma.DbNull } });
    }
  }
  return matched;
}
