import { checkupState } from "@/server/checkup";
import { withSession } from "@/server/guard";

/** What the network checkup last found, and which checks passed. */
export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ checkup: await checkupState() }));
}
