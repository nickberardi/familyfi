import { demoLocked } from "@/server/demo";
import { withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { getUpdateCheckSnapshot } from "@/server/update-check";
import { publicUpdateRun, requestUpdate, UpdaterError } from "@/server/updater";

const STATUS_BY_CODE = {
  updater_not_configured: 409,
  no_update_available: 409,
  update_in_progress: 409,
  updater_unreachable: 502,
} as const;

export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    try {
      const run = await requestUpdate({ update: getUpdateCheckSnapshot() });
      return Response.json({ run: publicUpdateRun(run) }, { status: 202 });
    } catch (error) {
      if (error instanceof UpdaterError) return jsonError(STATUS_BY_CODE[error.code], error.code, error.message);
      throw error;
    }
  });
}
