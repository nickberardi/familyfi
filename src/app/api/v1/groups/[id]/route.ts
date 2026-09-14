import { FamilyRole } from "@prisma/client";
import { z } from "zod";
import { AssignmentState } from "@prisma/client";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

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
    await prisma().group.delete({ where: { id } });
    const change = await enqueueChange("group");
    return Response.json({ ok: true, change });
  });
}
