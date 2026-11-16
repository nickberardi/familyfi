import { readBody, withMutation, withSession } from "@/server/guard";
import { deleteUpstreamCategory, getUpstreamCategory, updateUpstreamCategory, UpstreamCategoryUpdateBody } from "@/server/upstream/categories";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ category: await getUpstreamCategory(id) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, UpstreamCategoryUpdateBody, "Invalid category update.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ category: await updateUpstreamCategory(id, parsed.data) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    await deleteUpstreamCategory(id);
    return Response.json({ ok: true });
  });
}
