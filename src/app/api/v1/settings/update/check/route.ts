import { withAdmin } from "@/server/guard";
import { checkForUpdateNow } from "@/server/update-check";

export const dynamic = "force-dynamic";

/** Check now: ask GitHub and GHCR again, whatever the age of the last check, and answer with the result. */
export async function POST(request: Request) {
  return withAdmin(request, async () => Response.json({ update: await checkForUpdateNow() }));
}
