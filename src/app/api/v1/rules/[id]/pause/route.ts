import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { sessionActor } from "@/server/groups";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { publicRule, ruleInclude } from "@/server/rules";

const Body = z.object({
  until: z.string().datetime().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lifts a rule for every group it covers, from now until `until` or until resumed. It
 * replaces an earlier pause or allowance: a rule has one "not blocking until" state.
 */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    let value: unknown = {};
    try {
      value = await request.json();
    } catch {
      value = {};
    }
    const parsed = Body.safeParse(value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid pause request.");
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    if (!existing.enabled) return jsonError(409, "rule_off", "This rule is off.");
    const until = parsed.data.until ? new Date(parsed.data.until) : null;
    if (until && until.getTime() <= Date.now()) return jsonError(400, "invalid_request", "until must be in the future.");
    const rule = await prisma().rule.update({
      where: { id },
      data: {
        pauseActive: true,
        pauseUntil: until,
        pausedByAccountId: sessionActor(session).accountId,
        pausedByName: sessionActor(session).name,
      },
      include: ruleInclude,
    });
    const change = await enqueueChange("pause");
    return Response.json({ rule: publicRule(rule), change });
  });
}
