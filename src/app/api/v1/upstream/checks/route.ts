import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { checkIsFresh, publicUpstreamCheck } from "@/server/upstream-categories";
import { refreshResolverContexts } from "@/server/upstream/discovery";

/** Latest verdict per category, without the domain lists. */
export async function GET(request: Request) {
  return withSession(request, async () => {
    await refreshResolverContexts();
    const checks = await prisma().upstreamCheck.findMany({
      include: { category: { select: { slug: true, label: true } } },
      orderBy: { checkedAt: "desc" },
    });
    return Response.json({
      checks: checks.filter((check) => checkIsFresh(check)).map((check) => ({
        categoryId: check.categoryId,
        slug: check.category.slug,
        label: check.category.label,
        ...publicUpstreamCheck(check),
      })),
    });
  });
}
