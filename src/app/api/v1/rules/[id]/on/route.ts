import { withMutation } from "@/server/guard";
import { switchRule } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Turns a rule on, the counterpart to `/off`. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return switchRule(request, session, id, true);
  });
}
