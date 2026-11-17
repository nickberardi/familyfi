import { declineAsk } from "@/server/asks";
import { withAdmin } from "@/server/guard";

type Ctx = { params: Promise<{ id: string; askId: string }> };

/** A parent's Not now to a child's waiting ask. A yes is the verb that lifts what it asks about, with its `askId`. */
export async function POST(request: Request, ctx: Ctx) {
  return withAdmin(request, async (session) => {
    const { id, askId } = await ctx.params;
    return Response.json(await declineAsk(session, id, askId));
  });
}
