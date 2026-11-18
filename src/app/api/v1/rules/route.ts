import { childGroupIds, rulesForChild } from "@/server/child-day";
import { readBody, withMutation, withSession } from "@/server/guard";
import { ApiError } from "@/server/http";
import { createRule, listRules, RuleCreateBody } from "@/server/rules";

export async function GET(request: Request) {
  return withSession(request, async (session) => {
    const groupId = new URL(request.url).searchParams.get("groupId") ?? undefined;
    if (session.device?.clientType !== "me") return Response.json({ rules: await listRules(groupId) });
    // A child's phone (FamilyFi Me) reads only the rules that cover its own group or a shared Thing.
    const own = session.device.groupId;
    const reads = own ? await childGroupIds(own) : [];
    if (!own || (groupId !== undefined && !reads.includes(groupId))) throw new ApiError(404, "not_found", "Group not found.");
    return Response.json({ rules: await rulesForChild(await listRules(groupId), reads) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, RuleCreateBody, "Invalid rule.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await createRule(parsed.data), { status: 201 });
  });
}
