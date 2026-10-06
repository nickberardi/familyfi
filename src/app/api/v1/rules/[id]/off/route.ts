import { RuleLiftKind } from "@prisma/client";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { switchQuarantineRule } from "@/server/rule-lifts";
import { isQuarantineRule, presentRule, ruleInclude } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a rule off: its policies stay, disabled, and any pause on it ends. A group's pause is untouched. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing || existing.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    if (isQuarantineRule(existing)) return switchQuarantineRule(false);
    const rule = await prisma().rule.update({
      where: { id },
      data: { enabled: false, pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null },
      include: ruleInclude,
    });
    const change = await enqueueChange("rule");
    return Response.json({ rule: await presentRule(rule), change });
  });
}
