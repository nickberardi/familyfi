import { withAdmin } from "@/server/guard";
import { refreshStaleUpdateCheck } from "@/server/update-check";
import { updateSettings } from "@/server/updater";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    // An administrator looking at the update sees a release published or promoted since the hourly check.
    const [settings] = await Promise.all([updateSettings(), refreshStaleUpdateCheck()]);
    return Response.json(settings);
  });
}
