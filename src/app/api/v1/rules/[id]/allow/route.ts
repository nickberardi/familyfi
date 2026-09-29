import { withMutation } from "@/server/guard";
import { runLift } from "@/server/rule-lifts";

type Ctx = { params: Promise<{ id: string }> };

/** Overrides the rule while its window blocks, until `until` or until disallowed. For every group the rule covers. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    return runLift(request, session, "allow", { ruleId: id });
  });
}
