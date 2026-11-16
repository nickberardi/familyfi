import { readBody, withMutation, withSession } from "@/server/guard";
import { createRule, listRules, RuleCreateBody } from "@/server/rules";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const groupId = new URL(request.url).searchParams.get("groupId") ?? undefined;
    return Response.json({ rules: await listRules(groupId) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, RuleCreateBody, "Invalid rule.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await createRule(parsed.data), { status: 201 });
  });
}
