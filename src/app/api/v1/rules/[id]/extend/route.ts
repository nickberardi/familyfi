import { z } from "zod";
import { extendSuspensionUntil } from "@/lib/schedule";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { publicRule, ruleInclude } from "@/server/rules";

const Body = z.object({
  minutes: z.number().int().positive(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "minutes must be a positive integer.");
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    if (!existing.enabled) return jsonError(409, "rule_off", "This rule is off.");
    if (!existing.pauseActive) return jsonError(409, "not_paused", "Extend requires an active pause.");
    if (!existing.pauseUntil) return jsonError(409, "indefinite", "An indefinite pause has no expiry to extend.");
    const until = extendSuspensionUntil(existing.pauseUntil, new Date(), parsed.data.minutes * 60_000);
    const rule = await prisma().rule.update({ where: { id }, data: { pauseUntil: until }, include: ruleInclude });
    const change = await enqueueChange("extend");
    return Response.json({ rule: publicRule(rule), change });
  });
}
