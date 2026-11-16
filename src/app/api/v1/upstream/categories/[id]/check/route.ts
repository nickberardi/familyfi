import { withMutation } from "@/server/guard";
import { checkUpstreamCategory } from "@/server/upstream/categories";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ category: await checkUpstreamCategory(id) });
  });
}
