import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { sessionActor } from "@/server/groups";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { activeWindowsEnd, publicRule, ruleInclude, ruleInternetWindows } from "@/server/rules";

const Body = z.object({
  until: z.string().datetime().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lifts a rule while its window is blocking, until `until`: by default when the windows
 * active now end, or until resumed for an always-on rule. It is the same state as a pause.
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
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid allow request.");
    const existing = await prisma().rule.findUnique({ where: { id }, include: ruleInclude });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    if (!existing.enabled) return jsonError(409, "rule_off", "This rule is off.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const now = new Date();
    const defaultUntil = activeWindowsEnd(ruleInternetWindows(existing), now, household.timezone);
    if (parsed.data.until === undefined && defaultUntil === undefined) {
      return jsonError(409, "not_in_window", "This rule is not blocking now.");
    }
    const until = parsed.data.until === undefined ? defaultUntil ?? null : parsed.data.until === null ? null : new Date(parsed.data.until);
    if (until && until.getTime() <= now.getTime()) return jsonError(400, "invalid_request", "until must be in the future.");
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
    const change = await enqueueChange("allow");
    return Response.json({ rule: publicRule(rule), change });
  });
}
