import { FamRuleKind, FamRuleMode, type FamRule, type Group } from "@prisma/client";
import { assertSchedule } from "./schedule";

export type PublicRule = {
  id: string;
  kind: "category" | "app";
  groupId: string;
  targetIds: number[];
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
  internet: false;
};

export function publicRule(rule: FamRule): PublicRule {
  return {
    id: rule.id,
    kind: rule.kind,
    groupId: rule.groupId,
    targetIds: [...rule.targetIds],
    enabled: rule.enabled,
    mode: rule.mode,
    schedule: {
      enabled: rule.scheduleEnabled,
      days: [...rule.scheduleDays],
      start: rule.scheduleStart,
      end: rule.scheduleEnd,
    },
    internet: false,
  };
}

export function normalizeTargetIds(kind: FamRuleKind, raw: number[]): number[] {
  const ids = [...new Set(raw.map((n) => Math.trunc(n)).filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => a - b,
  );
  if (ids.length === 0) throw new Error("At least one target id is required.");
  if (kind === FamRuleKind.app && ids.length > 100) {
    throw new Error("App rules may target at most 100 applications.");
  }
  return ids;
}

export function assertMutableGroup(group: Group | null): asserts group is Group {
  if (!group) throw Object.assign(new Error("Group not found."), { code: "not_found", status: 404 });
  if (group.protected) {
    throw Object.assign(new Error("Protected groups cannot have category or app rules."), {
      code: "protected",
      status: 409,
    });
  }
}

export function parseRuleModeSchedule(input: {
  mode?: "always" | "scheduled";
  schedule?: { enabled: boolean; days: number[]; start: string | null; end: string | null };
}): {
  mode: FamRuleMode;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStart: string | null;
  scheduleEnd: string | null;
} {
  const mode = input.mode === "scheduled" || input.schedule?.enabled ? FamRuleMode.scheduled : FamRuleMode.always;
  if (mode === FamRuleMode.always) {
    return {
      mode,
      scheduleEnabled: false,
      scheduleDays: input.schedule?.days ?? [],
      scheduleStart: input.schedule?.start ?? null,
      scheduleEnd: input.schedule?.end ?? null,
    };
  }
  const schedule = {
    enabled: true,
    days: input.schedule?.days ?? [],
    start: input.schedule?.start ?? "",
    end: input.schedule?.end ?? "",
  };
  assertSchedule(schedule);
  return {
    mode,
    scheduleEnabled: true,
    scheduleDays: schedule.days,
    scheduleStart: schedule.start,
    scheduleEnd: schedule.end,
  };
}
