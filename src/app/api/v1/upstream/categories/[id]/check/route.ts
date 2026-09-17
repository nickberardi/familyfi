import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { publicUpstreamCategory } from "@/server/upstream-categories";
import { probeCategory } from "@/server/upstream/probe";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The design's per-category "Check now". Always returns 200 with the resulting
 * verdict, including `unknown` when the resolver could not be reached — a failed
 * sweep is a result to show, not a request that errored.
 */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const exists = await prisma().upstreamCategory.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return jsonError(404, "not_found", "Category not found.");

    await probeCategory(id);
    const category = await prisma().upstreamCategory.findUnique({
      where: { id },
      include: { domains: true, check: true },
    });
    if (!category) return jsonError(404, "not_found", "Category not found.");
    return Response.json({ category: publicUpstreamCategory(category) });
  });
}
