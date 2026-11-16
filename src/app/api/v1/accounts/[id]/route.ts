import { z } from "zod";
import { deleteAccount, getAccount, updateAccount } from "@/server/accounts";
import { readBody, withMutation, withSession } from "@/server/guard";

const Update = z.object({
  displayName: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  isAdmin: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ account: await getAccount(id) });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, Update, "Invalid account update.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateAccount(id, parsed.data));
  }, { demoLock: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const { change } = await deleteAccount(id);
    return Response.json({ ok: true, change });
  }, { demoLock: true });
}
