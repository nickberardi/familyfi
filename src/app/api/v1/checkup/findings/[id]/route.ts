import { z } from "zod";
import { dismissFinding } from "@/server/checkup";
import { readBody, withMutation } from "@/server/guard";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ dismissed: z.boolean() });

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const id = decodeURIComponent((await ctx.params).id);
    const parsed = await readBody(request, Body, "dismissed must be true or false.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ checkup: await dismissFinding(id, parsed.data.dismissed) });
  });
}
