import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold, connectionIdentity } from "@/server/unifi/connection";
import { builtInRefusal, switchQuarantineRule } from "@/server/rule-lifts";
import {
  builtInRule,
  householdNetworkScope,
  isQuarantineRule,
  presentRule,
  RuleInputError,
  ruleInclude,
  RuleUpdateBody,
  saveBuiltInRule,
  saveRule,
  validateRule,
} from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const rule = await prisma().rule.findUnique({ where: { id }, include: ruleInclude });
    if (!rule || rule.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    return Response.json({ rule: await presentRule(rule) });
  });
}

/**
 * Changes any field but the kind and scope. `windows` replaces the whole list: a window
 * sent with its `id` keeps its UniFi policy, one without an id is new, and a stored window
 * left out is removed with its policy.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = RuleUpdateBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid rule update.");
    const existing = await prisma().rule.findUnique({ where: { id }, include: ruleInclude });
    if (!existing || existing.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    const patch = parsed.data;
    const keys = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
    if (isQuarantineRule(existing)) {
      // Its switch is all that changes: anything else in the patch is an edit.
      if (keys.length !== 1 || patch.enabled === undefined) return builtInRefusal();
      return switchQuarantineRule(request, session, patch.enabled);
    }
    const builtIn = builtInRule(existing);
    if (builtIn === "dns" || builtIn === "countries") {
      // Its switch and what it applies to change, and Block countries' countries; its name, kind and schedule are FamilyFi's.
      const allowed = ["enabled", "scope", "groupIds", "networkIds", ...(builtIn === "countries" ? ["countries"] : [])];
      if (keys.length === 0 || keys.some((key) => !allowed.includes(key))) return builtInRefusal(builtIn);
      try {
        const rule = await saveBuiltInRule(builtIn, patch);
        const change = await enqueueChange("rule");
        return Response.json({ rule: await presentRule(rule), change });
      } catch (error) {
        if (error instanceof RuleInputError) return jsonError(error.status, error.code, error.message);
        throw error;
      }
    }
    if (patch.countries !== undefined) return jsonError(400, "invalid_request", "Only Block countries has countries.");
    if (patch.scope !== undefined && patch.scope !== existing.scope) {
      return jsonError(400, "invalid_request", "A rule's scope can't change. Make a new rule to cover something else.");
    }
    const current = await presentRule(existing);
    try {
      const input = await validateRule(
        {
          name: patch.name ?? current.name,
          kind: existing.kind,
          scope: existing.scope,
          groupIds: patch.groupIds ?? current.groupIds,
          networkIds: patch.networkIds ?? current.networkIds,
          targetIds: patch.targetIds ?? current.targetIds,
          domains: patch.domains ?? current.domains,
          enabled: patch.enabled ?? current.enabled,
          mode: patch.mode ?? current.mode,
          windows: (patch.windows ?? current.windows).map((window) => ({ ...window, name: window.name ?? "" })),
          useGeneratedName: patch.useGeneratedName ?? current.useGeneratedName,
        },
        // Unchanged networks were valid when saved; only a new list is checked against the site.
        patch.networkIds ? householdNetworkScope : async () => ({ scope: { manageAllNetworks: true, managedNetworkIds: [] } }),
      );
      const rule = await saveRule(input, id);
      const change = await enqueueChange("rule");
      return Response.json({ rule: await presentRule(rule), change });
    } catch (error) {
      if (error instanceof RuleInputError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().rule.findUnique({
      where: { id },
      include: { policies: true },
    });
    if (!existing || existing.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    const builtIn = builtInRule(existing);
    if (builtIn) return builtInRefusal(builtIn);
    // Delete recorded UniFi policies only (D3). Never touch a group's pause AppPolicy rows.
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
            // Reconcile will retry if the ownership row remains; proceed to clear desired state.
          }
        }
      } catch {
        // Desired-state delete still proceeds; Sync will surface connection errors.
      }
    }
    await prisma().rulePolicy.deleteMany({ where: { ruleId: id } });
    await prisma().rule.delete({ where: { id } });
    const change = await enqueueChange("rule");
    return Response.json({ change });
  });
}
