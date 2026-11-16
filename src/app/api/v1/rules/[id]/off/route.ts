import { withMutation } from "@/server/guard";
import { switchRule } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a rule off: its policies stay, disabled, and any pause on it ends. A group's pause is untouched. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return Response.json(await switchRule(session, id, false));
  });
}
