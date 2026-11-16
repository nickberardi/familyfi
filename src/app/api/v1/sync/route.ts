import { readsChangeActors } from "@/server/changes";
import { withSession } from "@/server/guard";
import { syncStatus } from "@/server/sync-status";

export async function GET(request: Request) {
  return withSession(request, async (session) => Response.json(await syncStatus({ withActors: readsChangeActors(session) })));
}
