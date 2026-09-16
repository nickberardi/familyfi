import type { GroupMode } from "@prisma/client";

/**
 * D11 legacy mapping (must match prisma/migrations/20260916000000_group_mode):
 * scheduleEnabled=true + not protected → scheduled
 * scheduleEnabled=false or protected → always
 *
 * Safe to re-apply against the same scheduleEnabled/protected pair (idempotent).
 */
export function modeFromLegacyScheduleEnabled(input: {
  scheduleEnabled: boolean;
  protected: boolean;
}): GroupMode {
  if (input.protected || !input.scheduleEnabled) return "always";
  return "scheduled";
}

export function applyD11ModeMapping<T extends { scheduleEnabled: boolean; protected: boolean }>(
  groups: T[],
): Array<T & { mode: GroupMode }> {
  return groups.map((group) => ({
    ...group,
    mode: modeFromLegacyScheduleEnabled(group),
  }));
}
