import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { switchQuarantineRule } from "@/server/rule-lifts";
import { builtInRule, isLockDnsRule, isQuarantineRule, presentRule, ruleInclude, saveCountriesRule, setLockDnsEnabled } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a rule on, the counterpart to `/off`. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const existing = await prisma().rule.findUnique({ where: { id } });
    if (!existing || existing.systemGroupId) return jsonError(404, "not_found", "Rule not found.");
    if (isQuarantineRule(existing)) return switchQuarantineRule(request, session, true);
    if (isLockDnsRule(existing)) {
      const rule = await setLockDnsEnabled(true);
      const change = await enqueueChange("rule");
      return Response.json({ rule: await presentRule(rule), change });
    }
    // Block countries switched on with no groups covers every group.
    const rule =
      builtInRule(existing) === "countries"
        ? await saveCountriesRule({ enabled: true })
        : await prisma().rule.update({ where: { id }, data: { enabled: true }, include: ruleInclude });
    const change = await enqueueChange("rule");
    return Response.json({ rule: await presentRule(rule), change });
  });
}
