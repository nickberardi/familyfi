import { z } from "zod";
import { readBody, withAdmin } from "@/server/guard";
import { setUpdateSchedule } from "@/server/updater";

const Body = z
  .object({
    enabled: z.boolean(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string(),
  })
  .strict();

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "Send enabled, at least one day (0 Sunday to 6 Saturday) and an HH:MM time.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await setUpdateSchedule(parsed.data));
  }, { demoLock: true });
}
