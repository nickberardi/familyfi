import { z } from "zod";
import { isPersonDevice } from "@/lib/client-type";
import { deleteGroup, getGroup, updateGroup } from "@/server/groups";
import { groupForChild, requireChildReads } from "@/server/child-day";
import { readBody, withMutation, withSession } from "@/server/guard";
import { ApiError } from "@/server/http";

const Update = z.object({
  name: z.string().min(1).optional(),
  monogram: z.string().max(4).nullable().optional(),
  familyRole: z.enum(["child", "teen", "adult"]).nullable().optional(),
  /** One of the group's own category, app or website rules, or null for all internet. */
  blockButtonRuleId: z.string().min(1).nullable().optional(),
  /** A Things group only: children with FamilyFi Me see it and ask for more time on it. */
  kidsCanAsk: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async (session) => {
    const { id } = await ctx.params;
    if (!isPersonDevice(session.device)) return Response.json({ group: await getGroup(id) });
    // A child's phone (FamilyFi Me) reads its own group and the shared Things; any other is not there for it.
    const own = session.device.groupId;
    if (!own) throw new ApiError(404, "not_found", "Group not found.");
    await requireChildReads(own, id);
    return Response.json({ group: await groupForChild(await getGroup(id), own) });
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
