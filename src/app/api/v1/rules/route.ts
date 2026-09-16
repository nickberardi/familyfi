import { FamRuleKind } from "@prisma/client";
import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import {
  assertMutableGroup,
  normalizeTargetIds,
  parseRuleModeSchedule,
  publicRule,
} from "@/server/rules";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const url = new URL(request.url);
    const groupId = url.searchParams.get("groupId") ?? undefined;
    const rules = await prisma().famRule.findMany({
      where: groupId ? { groupId } : undefined,
      orderBy: [{ groupId: "asc" }, { createdAt: "asc" }],
    });
    return Response.json({ rules: rules.map(publicRule) });
  });
}

const CreateBody = z.object({
  kind: z.enum(["category", "app"]),
  groupId: z.string().min(1),
  targetIds: z.array(z.number().int().positive()).min(1).max(100),
  enabled: z.boolean().optional(),
  mode: z.enum(["always", "scheduled"]).optional(),
  schedule: z
    .object({
      enabled: z.boolean(),
      days: z.array(z.number().int().min(0).max(6)),
      start: z.string().nullable(),
      end: z.string().nullable(),
    })
    .optional(),
});

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = CreateBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid rule.");
    const group = await prisma().group.findUnique({ where: { id: parsed.data.groupId } });
    try {
      assertMutableGroup(group);
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      return jsonError(err.status ?? 400, err.code ?? "invalid_request", err.message ?? "Invalid group.");
    }
    const kind = parsed.data.kind === "category" ? FamRuleKind.category : FamRuleKind.app;
    let targetIds: number[];
    try {
      targetIds = normalizeTargetIds(kind, parsed.data.targetIds);
    } catch (error) {
      return jsonError(400, "invalid_targets", error instanceof Error ? error.message : "Invalid targets.");
    }
    let scheduleFields;
    try {
      scheduleFields = parseRuleModeSchedule({ mode: parsed.data.mode, schedule: parsed.data.schedule });
    } catch (error) {
      return jsonError(400, "invalid_schedule", error instanceof Error ? error.message : "Invalid schedule.");
    }
    const rule = await prisma().famRule.create({
      data: {
        kind,
        groupId: group.id,
        targetIds,
        enabled: parsed.data.enabled ?? true,
        ...scheduleFields,
      },
    });
    const change = await enqueueChange("rule");
    return Response.json({ rule: publicRule(rule), change }, { status: 201 });
  });
}
