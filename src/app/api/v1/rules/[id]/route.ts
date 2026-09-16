import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold, connectionIdentity } from "@/server/unifi/connection";
import {
  normalizeTargetIds,
  parseRuleModeSchedule,
  publicRule,
} from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const rule = await prisma().famRule.findUnique({ where: { id } });
    if (!rule) return jsonError(404, "not_found", "Rule not found.");
    return Response.json({ rule: publicRule(rule) });
  });
}

const PatchBody = z.object({
  targetIds: z.array(z.number().int().positive()).min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(["always", "scheduled"]).optional(),
  schedule: z
    .object({
      enabled: z.boolean(),
      days: z.array(z.number().int().min(0).max(6)),
      start: z.string().nullable(),
      end: z.string().nullable(),
    })
    .optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = PatchBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid rule update.");
    const existing = await prisma().famRule.findUnique({ where: { id }, include: { group: true } });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    if (existing.group.protected) {
      return jsonError(409, "protected", "Protected groups cannot have category or app rules.");
    }
    let targetIds = existing.targetIds;
    if (parsed.data.targetIds) {
      try {
        targetIds = normalizeTargetIds(existing.kind, parsed.data.targetIds);
      } catch (error) {
        return jsonError(400, "invalid_targets", error instanceof Error ? error.message : "Invalid targets.");
      }
    }
    let scheduleFields: ReturnType<typeof parseRuleModeSchedule> | Record<string, never> = {};
    if (parsed.data.mode !== undefined || parsed.data.schedule !== undefined) {
      try {
        scheduleFields = parseRuleModeSchedule({
          mode: parsed.data.mode ?? existing.mode,
          schedule: parsed.data.schedule ?? {
            enabled: existing.scheduleEnabled,
            days: existing.scheduleDays,
            start: existing.scheduleStart,
            end: existing.scheduleEnd,
          },
        });
      } catch (error) {
        return jsonError(400, "invalid_schedule", error instanceof Error ? error.message : "Invalid schedule.");
      }
    }
    const rule = await prisma().famRule.update({
      where: { id },
      data: {
        targetIds,
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...scheduleFields,
      },
    });
    const change = await enqueueChange("rule");
    return Response.json({ rule: publicRule(rule), change });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().famRule.findUnique({
      where: { id },
      include: { policies: true, group: true },
    });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    // Delete recorded UniFi policies only (D3). Never touch internet AppPolicy rows.
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
    await prisma().famRulePolicy.deleteMany({ where: { famRuleId: id } });
    await prisma().famRule.delete({ where: { id } });
    const change = await enqueueChange("rule");
    return Response.json({ change });
  });
}
