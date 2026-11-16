import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { clearGroupResolver, getGroupResolver, setGroupResolver } from "@/server/upstream/group-resolver";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ url: z.string().min(1) });

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ resolver: await getGroupResolver(id) });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, Body, "Paste the endpoint URL.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ group: await setGroupResolver(id, parsed.data.url) });
  }, { demoLock: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    return Response.json({ group: await clearGroupResolver(id) });
  }, { demoLock: true });
}
