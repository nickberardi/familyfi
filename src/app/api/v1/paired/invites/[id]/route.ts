import { withAdmin } from "@/server/guard";
import { cancelPendingInvite, getInvite } from "@/server/pairing";

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
    await cancelPendingInvite(id);
    return Response.json({ ok: true });
  });
}
