import { withSession } from "@/server/guard";
import { syncStatus } from "@/server/sync-status";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json(await syncStatus()));
}
