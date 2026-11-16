import { runCheckupNow } from "@/server/checkup-run";
import { withMutation } from "@/server/guard";

export async function POST(request: Request) {
  return withMutation(request, async () => Response.json({ checkup: await runCheckupNow() }));
}
