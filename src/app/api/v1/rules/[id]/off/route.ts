import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { publicRule } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

/** Per-rule off — desired enabled:false (UniFi Pause semantics). Internet policy untouched. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const existing = await prisma().famRule.findUnique({ where: { id }, include: { group: true } });
    if (!existing) return jsonError(404, "not_found", "Rule not found.");
    if (existing.group.protected) {
      return jsonError(409, "protected", "Protected groups cannot have category or app rules.");
    }
    const rule = await prisma().famRule.update({
      where: { id },
      data: { enabled: false },
    });
    const change = await enqueueChange("rule");
    return Response.json({ rule: publicRule(rule), change });
  });
}
