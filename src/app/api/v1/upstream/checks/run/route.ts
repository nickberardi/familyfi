import { withMutation } from "@/server/guard";
import { probeEnabledCategories } from "@/server/upstream/probe";

/** One sweep over every category with checking on. Disabled ones keep their result. */
export async function POST(request: Request) {
  return withMutation(request, async () => {
    const outcomes = await probeEnabledCategories();
    return Response.json({
      outcomes: outcomes.map((outcome) => ({
        categoryId: outcome.categoryId,
        slug: outcome.slug,
        verdict: outcome.verdict,
        blockedCount: outcome.blockedCount,
        totalCount: outcome.totalCount,
      })),
    });
  });
}
