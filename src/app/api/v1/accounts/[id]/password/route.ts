import { z } from "zod";
import { setAccountPassword } from "@/server/accounts";
import { readBody, withMutation } from "@/server/guard";

const Body = z.object({
  password: z.string().min(8),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, Body, "password must be at least 8 characters.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await setAccountPassword(id, parsed.data.password));
  }, { demoLock: true });
}
