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

/** How long an administrator's confirmation to remove a leftover stands: the removal that recorded it. */
export const DELETE_CONFIRMATION_MS = 2 * 60_000;

/**
 * Whether an administrator just confirmed removing this policy from Checkup's leftover list: a
 * `PolicyOperation` with intent `delete` and status `confirmed`, recorded in the last two minutes,
 * names it. It allows that one delete and nothing else; the policy is still not FamilyFi's, so it
 * is never updated. The removal holds the reconcile lock and settles the row before releasing it,
 * and every sync pass fails any row left behind before it writes (`expireDeleteConfirmations`).
 */
export async function deleteConfirmed(scope: OwnershipScope, siteId: string, policyId: string, now = new Date()): Promise<boolean> {
  if (!scope.siteId || siteId !== scope.siteId) return false;
  const where = { unifiPolicyId: policyId, connectionIdentity: scope.connectionIdentity, siteId };
  const since = new Date(now.getTime() - DELETE_CONFIRMATION_MS);
  return (await prisma().policyOperation.count({ where: { ...where, intent: PolicyOperationIntent.delete, status: "confirmed", createdAt: { gte: since } } })) > 0;
}

/**
 * Fails every confirmation a removal left behind (it stopped between recording it and deleting).
 * Called with the reconcile lock held, when no removal can be running, so none of them stands.
 */
export async function expireDeleteConfirmations(): Promise<void> {
  await prisma().policyOperation.updateMany({ where: { intent: PolicyOperationIntent.delete, status: "confirmed" }, data: { status: "failed" } });
}

/**
 * The client every FamilyFi write goes through. Updating or deleting a policy that is not
 * on record throws `PolicyOwnershipError` before any request is sent, whichever code path
 * supplied the id, except deleting one an administrator confirmed (`deleteConfirmed`);
 * everything else passes straight through to `client`.
 */
export function withPolicyOwnership(
  client: UnifiClient,
  scope: OwnershipScope,
): UnifiClient {
  const assertOnRecord = async (action: "update" | "delete", siteId: string, policyId: string) => {
    if (await policyOnRecord(scope, siteId, policyId)) return;
    // The one exception: a leftover an administrator ticked and confirmed in Checkup.
    if (action === "delete" && (await deleteConfirmed(scope, siteId, policyId))) return;
    throw new PolicyOwnershipError(action, policyId);
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
