import { z } from "zod";
import { assertSchedule } from "@/server/schedule";
import { enqueueChange } from "@/server/changes";
import { publicGroup } from "@/server/groups";
import { prisma } from "@/server/db";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

const Body = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)),
  start: z.string(),
  end: z.string(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid schedule.");
    try {
      assertSchedule({
        enabled: parsed.data.enabled,
        days: parsed.data.days,
        start: parsed.data.start,
        end: parsed.data.end,
      });
    } catch (error) {
      return jsonError(400, "invalid_schedule", error instanceof Error ? error.message : "Invalid schedule.");
    }
    const existing = await prisma().group.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Group not found.");
    if (existing.protected) return jsonError(409, "protected", "Protected groups do not use schedules.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const group = await prisma().group.update({
      where: { id },
      data: {
        mode: parsed.data.enabled ? "scheduled" : "always",
        scheduleEnabled: parsed.data.enabled,
        scheduleDays: parsed.data.days,
        scheduleStart: parsed.data.start,
        scheduleEnd: parsed.data.end,
        ...(!parsed.data.enabled ? { suspensionActive: false, suspensionUntil: null } : {}),
      },
      include: { _count: { select: { devices: true } } },
    });
    const change = await enqueueChange("schedule");
    return Response.json({ group: publicGroup(group, household.timezone), change });
  });
}
