import { PolicyOperationIntent } from "@prisma/client";
import { prisma } from "../db";
import type { UnifiClient } from "./client";
import { PolicyOwnershipError } from "./errors";

/** The console and site a client writes to, as `connectionIdentity` records them. */
export type OwnershipScope = { connectionIdentity: string; siteId: string | null };

/**
 * Whether FamilyFi has this UniFi policy on record for this console and site: an
 * `AppPolicy` or `RulePolicy` row holds its id, or an applied create operation returned
 * it. Never by name: an administrator's policy can carry any name, and so may ours.
 */
export async function policyOnRecord(scope: OwnershipScope, siteId: string, policyId: string): Promise<boolean> {
  if (!scope.siteId || siteId !== scope.siteId) return false;
  const where = { unifiPolicyId: policyId, connectionIdentity: scope.connectionIdentity, siteId };
  const [appPolicies, rulePolicies, creations] = await Promise.all([
    prisma().appPolicy.count({ where }),
    prisma().rulePolicy.count({ where }),
    prisma().policyOperation.count({ where: { ...where, intent: PolicyOperationIntent.create, status: "applied" } }),
  ]);
  return appPolicies + rulePolicies + creations > 0;
}

/**
 * The client every FamilyFi write goes through. Updating or deleting a policy that is not
 * on record throws `PolicyOwnershipError` before any request is sent, whichever code path
 * supplied the id; everything else passes straight through to `client`.
 */
export function withPolicyOwnership(client: UnifiClient, scope: OwnershipScope): UnifiClient {
  const assertOnRecord = async (action: "update" | "delete", siteId: string, policyId: string) => {
    if (!(await policyOnRecord(scope, siteId, policyId))) throw new PolicyOwnershipError(action, policyId);
  };
  const guarded: Pick<UnifiClient, "updatePolicy" | "deletePolicy"> = {
    async updatePolicy(siteId, policyId, body) {
      await assertOnRecord("update", siteId, policyId);
      return client.updatePolicy(siteId, policyId, body);
    },
    async deletePolicy(siteId, policyId) {
      await assertOnRecord("delete", siteId, policyId);
      return client.deletePolicy(siteId, policyId);
    },
  };
  // A proxy rather than a copy, so a test fixture's own state stays on the one object.
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "updatePolicy" || property === "deletePolicy") return guarded[property];
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
