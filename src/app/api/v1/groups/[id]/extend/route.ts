import { z } from "zod";
import { watchGroupControlAllowed } from "@/server/auth";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { extendSuspensionUntil } from "@/lib/schedule";
import { prisma } from "@/server/db";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  minutes: z.number().int().positive(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "minutes must be a positive integer.");
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    if (!watchGroupControlAllowed(session, existing)) return jsonError(403, "watch_group_forbidden", "The Watch cannot control this group.");
    if (!existing.suspensionActive) return jsonError(409, "not_paused", "Extend requires an active pause.");
    if (!existing.suspensionUntil) {
      return jsonError(409, "indefinite", "An indefinite pause has no expiry to extend.");
    }
    const until = extendSuspensionUntil(existing.suspensionUntil, new Date(), parsed.data.minutes * 60_000);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: { suspensionUntil: until },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("extend");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}
