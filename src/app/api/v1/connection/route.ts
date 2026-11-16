import { connectionOverview } from "@/server/connection-endpoints";
import { withSession } from "@/server/guard";

export async function GET(request: Request) {
  return withSession(request, async (session) => Response.json(await connectionOverview(session)));
}
