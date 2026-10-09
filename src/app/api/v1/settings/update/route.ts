import { withAdmin } from "@/server/guard";
import { updateSettings } from "@/server/updater";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withAdmin(request, async () => Response.json(await updateSettings()));
}
