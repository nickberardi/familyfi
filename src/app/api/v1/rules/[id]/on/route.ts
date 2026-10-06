import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { switchQuarantineRule } from "@/server/rule-lifts";
import { isQuarantineRule, presentRule, ruleInclude } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a rule on, the counterpart to `/off`. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing || existing.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    if (isQuarantineRule(existing)) return switchQuarantineRule(true);
    const rule = await prisma().rule.update({
      where: { id },
      data: { enabled: true },
      include: ruleInclude,
    });
    const change = await enqueueChange("rule");
    return Response.json({ rule: await presentRule(rule), change });
  });
}
