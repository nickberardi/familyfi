import { withSession } from "@/server/guard";
import { listUpstreamChecks } from "@/server/upstream/categories";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ checks: await listUpstreamChecks() }));
}
