import { withMutation } from "@/server/guard";
import { guestResponseError } from "@/server/guest-http";
import { revokeGuestVoucher } from "@/server/guests";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    try { return Response.json({ voucher: await revokeGuestVoucher(id) }); }
    catch (error) { return guestResponseError(error); }
  });
}
