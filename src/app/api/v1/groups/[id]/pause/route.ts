import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  until: z.string().datetime().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    let value: unknown = {};
    try {
      value = await request.json();
    } catch {
      value = {};
    }
    const parsed = Body.safeParse(value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid pause request.");
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    if (existing.protected) return jsonError(409, "protected", "Protected groups cannot be paused.");
    // Always and Scheduled both allow Pause (D1). mode=always has no bedtime schedule requirement.
    const until = parsed.data.until === undefined ? null : parsed.data.until === null ? null : new Date(parsed.data.until);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: { suspensionActive: true, suspensionUntil: until },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("pause");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}
