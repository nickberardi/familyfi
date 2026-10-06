import { RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { QUARANTINE_RULE_ID } from "@/lib/rules";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import {
  householdNetworkScope,
  presentRule,
  presentRules,
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
      where: { systemGroupId: null, ...(groupId ? { scope: RuleScope.group, groups: { some: { groupId } } } : {}) },
      include: ruleInclude,
      orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
    });
    // The built-in quarantine rule covers no group, so a group's list leaves it out; it leads every other.
    rules.sort((a, b) => Number(b.id === QUARANTINE_RULE_ID) - Number(a.id === QUARANTINE_RULE_ID));
    return Response.json({ rules: await presentRules(rules) });
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
      return Response.json({ rule: await presentRule(rule), change }, { status: 201 });
    } catch (error) {
      if (error instanceof RuleInputError) return jsonError(error.status, error.code, error.message);
      throw error;
    }
  });
}
