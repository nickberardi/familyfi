import { readBody, withAdmin } from "@/server/guard";
import { setUpdateSchedule, UpdateScheduleBody } from "@/server/updater";

export async function PUT(request: Request) {
  return withAdmin(request, async () => {
    const parsed = await readBody(request, UpdateScheduleBody, "Send enabled, at least one day (0 Sunday to 6 Saturday) and an HH:MM time.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await setUpdateSchedule(parsed.data));
  }, { demoLock: true });
}
