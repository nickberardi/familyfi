import { FamilyRole } from "@prisma/client";
import { z } from "zod";
import { AssignmentState } from "@prisma/client";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold, connectionIdentity } from "@/server/unifi/connection";

const Update = z.object({
  name: z.string().min(1).optional(),
  monogram: z.string().max(4).nullable().optional(),
  familyRole: z.enum(["child", "teen", "adult"]).nullable().optional(),
  protected: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.findUnique({
      where: { id },
      include: { _count: { select: { devices: true } } },
    });
    if (!group) return jsonError(404, "not_found", "Group not found.");
    return Response.json({ group: publicGroup(group, household.timezone) });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Update.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid group update.");
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: {
        name: parsed.data.name,
        monogram: parsed.data.monogram === undefined ? undefined : parsed.data.monogram,
        familyRole: parsed.data.familyRole === undefined ? undefined : (parsed.data.familyRole as FamilyRole | null),
        protected: parsed.data.protected,
      },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("group");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    await prisma().device.updateMany({
      where: { groupId: id },
      data: { groupId: null, assignment: AssignmentState.quarantined },
    });
    // Delete recorded DPI UniFi policies before cascading FamRule rows (D3).
    const rules = await prisma().famRule.findMany({ where: { groupId: id }, include: { policies: true } });
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    if (household && household.connectionStatus !== "unconfigured" && household.unifiSiteId) {
      try {
        const client = clientForHousehold(household);
        const identity = connectionIdentity(household);
        for (const rule of rules) {
          for (const policy of rule.policies) {
            if (policy.connectionIdentity !== identity || policy.siteId !== household.unifiSiteId) continue;
            if (!policy.unifiPolicyId) continue;
            try {
              await client.deletePolicy(household.unifiSiteId, policy.unifiPolicyId);
            } catch {
              // Ownership cleared with FamRule cascade; Sync may surface leftovers.
            }
          }
        }
      } catch {
        // Proceed with desired-state delete.
      }
    }
    await prisma().famRulePolicy.deleteMany({ where: { famRuleId: { in: rules.map((r) => r.id) } } });
    await prisma().famRule.deleteMany({ where: { groupId: id } });
    await prisma().group.delete({ where: { id } });
    const change = await enqueueChange("group");
    return Response.json({ ok: true, change });
  });
}
