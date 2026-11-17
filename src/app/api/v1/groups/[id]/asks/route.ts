import { AskBody, fileAsk, requireChild } from "@/server/asks";
import { readBody, withMutation } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

/** A child's ask for more time, from FamilyFi Me on its own group: to be unpaused, or minutes in a rule's window. */
export async function POST(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    requireChild(session);
    const read = await readBody(request, AskBody, "about is pause, or rule with ruleId and minutes.");
    if (!read.ok) return read.response;
    return Response.json(await fileAsk(session, id, read.data));
  });
}
