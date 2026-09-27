import { withMutation } from "@/server/guard";
import { guestResponseError } from "@/server/guest-http";
import { revokeGuestPass } from "@/server/guests";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    try { return Response.json({ pass: await revokeGuestPass(id) }); }
    catch (error) { return guestResponseError(error); }
  });
}
