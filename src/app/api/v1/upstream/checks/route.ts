import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { publicUpstreamCheck } from "@/server/upstream-categories";

/** Latest verdict per category, without the domain lists. */
export async function GET(request: Request) {
  return withSession(request, async () => {
    const checks = await prisma().upstreamCheck.findMany({
      include: { category: { select: { slug: true, label: true } } },
      orderBy: { checkedAt: "desc" },
    });
    return Response.json({
      checks: checks.map((check) => ({
        categoryId: check.categoryId,
        slug: check.category.slug,
        label: check.category.label,
        ...publicUpstreamCheck(check),
      })),
    });
  });
}
