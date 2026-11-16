import { z } from "zod";
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
  return withSession(request, async () => Response.json({ groups: await listGroups() }));
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
