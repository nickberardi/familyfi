import { withSession } from "@/server/guard";
import { listDpi } from "@/server/unifi/dpi-catalog";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const filter = new URL(request.url).searchParams.get("filter") ?? undefined;
    return Response.json({ applications: await listDpi("applications", filter) });
  });
}
