import { z } from "zod";
import { parseHm } from "@/lib/schedule";
import { demoLocked } from "@/server/demo";
import { prisma } from "@/server/db";
import { readJson, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { rescheduleAutoUpdate, updateSettings } from "@/server/updater";

const Body = z
  .object({
    enabled: z.boolean(),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    time: z.string(),
  })
  .strict();

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Send enabled, days (0 Sunday to 6 Saturday) and an HH:MM time.");
    try {
      parseHm(parsed.data.time);
    } catch (error) {
      return jsonError(400, "invalid_request", (error as Error).message);
    }
    const days = [...new Set(parsed.data.days)].sort((left, right) => left - right);
    if (parsed.data.enabled && days.length === 0) {
      return jsonError(400, "invalid_request", "Automatic updates need at least one day.");
    }
    await prisma().household.update({
      where: { id: "default" },
      data: { autoUpdateEnabled: parsed.data.enabled, autoUpdateDays: days, autoUpdateTime: parsed.data.time },
    });
    rescheduleAutoUpdate();
    return Response.json(await updateSettings());
  });
}
