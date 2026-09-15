import { FamilyRole, GroupKind, GroupMode } from "@prisma/client";
import { isDesiredBlocked, isSuspended, type Schedule, type Suspension } from "./schedule";

export type GroupAccess = "available" | "blocked" | "paused" | "protected" | "always_on";

export function groupAccess(
  group: {
    protected: boolean;
    mode: GroupMode;
    scheduleEnabled: boolean;
    scheduleDays: number[];
    scheduleStart: string | null;
    scheduleEnd: string | null;
    suspensionActive: boolean;
    suspensionUntil: Date | null;
  },
  now: Date,
  timezone: string,
): GroupAccess {
  if (group.protected) return "protected";
  const suspension: Suspension = { active: group.suspensionActive, until: group.suspensionUntil };
  if (isSuspended(suspension, now)) return "paused";
  if (group.mode === "always") return "always_on";
  const schedule: Schedule = {
    enabled: group.scheduleEnabled && Boolean(group.scheduleStart && group.scheduleEnd),
    days: group.scheduleDays,
    start: group.scheduleStart ?? "21:00",
    end: group.scheduleEnd ?? "07:00",
  };
  if (isDesiredBlocked({ protected: false, schedule, suspension, now, timezone })) return "blocked";
  return "available";
}

export function publicGroup(
  group: {
    id: string;
    kind: GroupKind;
    name: string;
    monogram: string | null;
    familyRole: FamilyRole | null;
    protected: boolean;
    mode: GroupMode;
    scheduleEnabled: boolean;
    scheduleDays: number[];
    scheduleStart: string | null;
    scheduleEnd: string | null;
    suspensionActive: boolean;
    suspensionUntil: Date | null;
    _count?: { devices: number };
  },
  timezone: string,
  now = new Date(),
) {
  return {
    id: group.id,
    kind: group.kind,
    name: group.name,
    monogram: group.monogram,
    familyRole: group.familyRole,
    protected: group.protected,
    mode: group.mode,
    deviceCount: group._count?.devices ?? 0,
    schedule: {
      enabled: group.mode === "scheduled" && group.scheduleEnabled,
      days: group.scheduleDays,
      start: group.scheduleStart,
      end: group.scheduleEnd,
    },
    suspension: {
      active: group.suspensionActive,
      until: group.suspensionUntil?.toISOString() ?? null,
    },
    access: groupAccess(group, now, timezone),
  };
}
