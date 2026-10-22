import { z } from "zod";
import { checkupState, setFindingDismissed } from "@/server/checkup";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ dismissed: z.boolean() });

/** Dismiss a finding ("Dismiss", or "This is intended" for a note), or show it again. It stays dismissed until what was seen changes. */
export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const id = decodeURIComponent((await ctx.params).id);
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "dismissed must be true or false.");
    if (!(await setFindingDismissed(id, parsed.data.dismissed))) return jsonError(404, "not_found", "Finding not found.");
    return Response.json({ checkup: await checkupState() });
  });
}
