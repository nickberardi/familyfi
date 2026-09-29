import { withMutation } from "@/server/guard";
import { runLift } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Ends a pause. An allowance is ended by `disallow`. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runLift(request, session, "resume", { ruleId: id });
  });
}
