import { withMutation } from "@/server/guard";
import { runUpstreamChecks } from "@/server/upstream/categories";

export async function POST(request: Request) {
  return withMutation(request, async () => Response.json({ outcomes: await runUpstreamChecks() }));
}
