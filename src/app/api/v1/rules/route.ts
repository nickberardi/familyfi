import { RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import {
  householdNetworkScope,
  publicRule,
  RuleCreateBody,
  RuleInputError,
  ruleInclude,
  saveRule,
  validateRule,
} from "@/server/rules";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const url = new URL(request.url);
    const groupId = url.searchParams.get("groupId") ?? undefined;
    const rules = await prisma().rule.findMany({
      where: groupId ? { scope: RuleScope.group, groups: { some: { groupId } } } : undefined,
      include: ruleInclude,
      orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ rules: rules.map(publicRule) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = RuleCreateBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid rule.");
    try {
      const input = await validateRule(
        {
          name: parsed.data.name,
          kind: parsed.data.kind as RuleKind,
          scope: (parsed.data.scope ?? "group") as RuleScope,
          groupIds: parsed.data.groupIds ?? [],
          networkIds: parsed.data.networkIds ?? [],
          targetIds: parsed.data.targetIds ?? [],
          domains: parsed.data.domains ?? [],
          enabled: parsed.data.enabled ?? true,
          mode: parsed.data.mode as RuleMode,
          windows: (parsed.data.windows ?? []).map((window) => ({ ...window, id: undefined, name: window.name ?? "" })),
          useGeneratedName: parsed.data.useGeneratedName ?? false,
        },
        householdNetworkScope,
      );
      const rule = await saveRule(input);
      const change = await enqueueChange("rule");
      return Response.json({ rule: publicRule(rule), change }, { status: 201 });
    } catch (error) {
      if (error instanceof RuleInputError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
  });
}
