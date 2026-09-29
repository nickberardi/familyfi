import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { publicRule, ruleInclude } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Ends a pause or allowance: the rule blocks again. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    const rule = await prisma().rule.update({
      where: { id },
      data: { pauseActive: false, pauseUntil: null, pausedByAccountId: null, pausedByName: null },
      include: ruleInclude,
    });
    const change = await enqueueChange("resume");
    return Response.json({ rule: publicRule(rule), change });
  });
}
