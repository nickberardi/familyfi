import { z } from "zod";
import { parseHm } from "@/lib/schedule";
import { demoLocked } from "@/server/demo";
import { prisma } from "@/server/db";
import { readBody, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { rescheduleAutoUpdate, updateSettings } from "@/server/updater";
import { weeklyCron } from "@/server/weekly-schedule";

const Body = z
  .object({
    enabled: z.boolean(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string(),
  })
  .strict();

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    const parsed = await readBody(request, Body, "Send enabled, at least one day (0 Sunday to 6 Saturday) and an HH:MM time.");
    if (!parsed.ok) return parsed.response;
    try {
      parseHm(parsed.data.time);
    } catch (error) {
      return jsonError(400, "invalid_request", (error as Error).message);
    }
    await prisma().household.update({
      where: { id: "default" },
      data: { updateScheduleEnabled: parsed.data.enabled, updateSchedule: weeklyCron(parsed.data) },
    });
    rescheduleAutoUpdate();
    return Response.json(await updateSettings());
  });
}
