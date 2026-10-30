import { withAdmin } from "@/server/guard";
import { refreshStaleUpdateCheck } from "@/server/update-check";
import { updateSettings } from "@/server/updater";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const settings = await updateSettings();
    // An administrator looking at the update sees a release published or promoted since the hourly
    // check. Not while an install is under way: its five-second polls must not wait on GitHub.
    if (settings.lastRun?.status !== "requested") await refreshStaleUpdateCheck();
    return Response.json(settings);
  });
}
