import type { Household } from "@prisma/client";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { ApiError } from "./http";
import { storedQuarantineBlocking } from "./quarantine";
import { setQuarantineEnforced } from "./rules";
import { rescheduleAutoUpdate } from "./updater";
import { rescheduleUpstreamProbe } from "./upstream/schedule";

/** The one household this deployment serves. */
export function loadHousehold(): Promise<Household> {
  return prisma().household.findUniqueOrThrow({ where: { id: "default" } });
}

export async function publicHousehold(household: Household) {
  const live = await storedQuarantineBlocking();
  return {
    timezone: household.timezone,
    revision: household.revision,
    quarantineEnforced: household.quarantineEnforced,
    quarantineObservedEnabled: live.observedEnabled,
    quarantinePolicyCount: live.policyCount,
    displayName: household.displayName,
  };
}

export async function getHouseholdSettings() {
  return publicHousehold(await loadHousehold());
}

export async function updateHouseholdSettings(input: { timezone?: string; displayName?: string; quarantineEnforced?: boolean }) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new ApiError(400, "invalid_timezone", "Use an IANA timezone name.");
    }
  }
  const data = {
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
  };
  // The same switch as the built-in quarantine rule's: turning it off ends a pause on it.
  const household =
    input.quarantineEnforced !== undefined
      ? await setQuarantineEnforced(input.quarantineEnforced, data)
      : await prisma().household.update({ where: { id: "default" }, data });
  const change = await enqueueChange(input.quarantineEnforced !== undefined ? "quarantine" : "household");
  // Both schedules are kept in the household's time zone.
  if (input.timezone) {
    rescheduleUpstreamProbe();
    rescheduleAutoUpdate();
  }
  return { household: await publicHousehold(household), change };
}
