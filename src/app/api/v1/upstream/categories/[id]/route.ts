import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { deleteUpstreamCategory, getUpstreamCategory, updateUpstreamCategory } from "@/server/upstream/categories";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ category: await getUpstreamCategory(id) });
  });
}

const PatchBody = z.object({
  label: z.string().min(1).max(60).optional(),
  monogram: z.string().min(1).max(4).optional(),
  enabled: z.boolean().optional(),
  /** The whole active list, replacing what is there. */
  domains: z.array(z.string()).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, PatchBody, "Invalid category update.");
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
