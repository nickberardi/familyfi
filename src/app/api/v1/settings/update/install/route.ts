import { withAdmin } from "@/server/guard";
import { installUpdate } from "@/server/updater";

export async function POST(request: Request) {
  return withAdmin(request, async () => Response.json({ run: await installUpdate() }, { status: 202 }), { demoLock: true });
}
