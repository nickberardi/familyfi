import { z } from "zod";
import { childGroupIds, groupForChild } from "@/server/child-day";
import { createGroup, listGroups } from "@/server/groups";
import { readBody, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";

const Create = z.object({
  kind: z.enum(["family", "things"]),
  name: z.string().min(1),
  monogram: z.string().max(4).optional(),
  familyRole: z.enum(["child", "teen", "adult"]).optional(),
});

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    if (session.device?.clientType !== "me") return Response.json({ groups: await listGroups() });
    // A child's phone (FamilyFi Me) reads its own group first, then the Things shared with children.
    const own = session.device.groupId;
    const reads = own ? await childGroupIds(own) : [];
    const groups = await listGroups();
    const read = reads.flatMap((id) => groups.filter((group) => group.id === id));
    return Response.json({ groups: await Promise.all(read.map((group) => groupForChild(group, own!))) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, Create, "kind and name are required.");
    if (!parsed.ok) return parsed.response;
    if (parsed.data.kind === "family" && !parsed.data.familyRole) {
      return jsonError(400, "invalid_request", "Family groups need a role.");
    }
    return Response.json(await createGroup(parsed.data), { status: 201 });
  });
}
