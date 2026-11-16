import { listDevices } from "@/server/devices";
import { withSession } from "@/server/guard";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const assignment = new URL(request.url).searchParams.get("assignment");
    return Response.json({ devices: await listDevices(assignment) });
  });
}
