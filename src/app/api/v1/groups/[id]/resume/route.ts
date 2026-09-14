import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: { suspensionActive: false, suspensionUntil: null },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("resume");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}
