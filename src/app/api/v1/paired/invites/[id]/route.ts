import { withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { cancelInvite, getInvite } from "@/server/pairing";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    return Response.json({ invite: await getInvite(id) });
  });
}

export async function DELETE(request: Request, context: Ctx) {
  return withAdmin(request, async () => {
    const { id } = await context.params;
    if (!(await cancelInvite(id))) return jsonError(404, "not_found", "No pending invite with that id.");
    return Response.json({ ok: true });
  });
}
