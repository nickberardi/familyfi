import { getChange } from "@/server/changes";
import { withSession } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ change: await getChange(id) });
  });
}
