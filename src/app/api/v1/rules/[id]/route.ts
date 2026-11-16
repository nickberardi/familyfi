import { readBody, withMutation, withSession } from "@/server/guard";
import { deleteRule, updateRule } from "@/server/rule-lifts";
import { getRule, RuleUpdateBody } from "@/server/rules";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ rule: await getRule(id) });
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, RuleUpdateBody, "Invalid rule update.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateRule(session, id, parsed.data));
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    return Response.json(await deleteRule(id));
  });
}
