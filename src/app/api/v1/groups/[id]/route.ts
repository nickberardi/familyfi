import { z } from "zod";
import { deleteGroup, getGroup, updateGroup } from "@/server/groups";
import { groupForChild } from "@/server/child-day";
import { readBody, withMutation, withSession } from "@/server/guard";
import { ApiError } from "@/server/http";

const Update = z.object({
  name: z.string().min(1).optional(),
  monogram: z.string().max(4).nullable().optional(),
  familyRole: z.enum(["child", "teen", "adult"]).nullable().optional(),
  /** One of the group's own category, app or website rules, or null for all internet. */
  blockButtonRuleId: z.string().min(1).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async (session) => {
    const { id } = await ctx.params;
    if (session.device?.clientType !== "me") return Response.json({ group: await getGroup(id) });
    // A child's phone (FamilyFi Me) reads its own group alone; any other is not there for it.
    if (id !== session.device.groupId) throw new ApiError(404, "not_found", "Group not found.");
    return Response.json({ group: await groupForChild(await getGroup(id)) });
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const parsed = await readBody(request, Update, "Invalid group update.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateGroup(id, parsed.data));
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const { change } = await deleteGroup(id);
    return Response.json({ ok: true, change });
  });
}
