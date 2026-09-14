import { publicChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const change = await prisma().changeResult.findUnique({ where: { id } });
    if (!change) return jsonError(404, "not_found", "Change not found.");
    return Response.json({ change: publicChange(change) });
  });
}
