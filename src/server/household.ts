import type { Household } from "@prisma/client";
import { householdTimezone } from "@/lib/household-state";
import { enqueueChange } from "./changes";
import { prisma } from "./db";
import { ApiError } from "./http";
import { storedQuarantineBlocking } from "./quarantine";
import { setQuarantineEnforced } from "./rules";
import { rescheduleAutoUpdate } from "./updater";
import { rescheduleUpstreamProbe } from "./upstream/schedule";
import { currentHouseholdId } from "./household-context";

/** The one household this deployment serves. */
export function loadHousehold(): Promise<Household> {
  return prisma().household.findUniqueOrThrow({ where: { id: currentHouseholdId() } });
}

async function publicHousehold(household: Household) {
  const live = await storedQuarantineBlocking();
  return {
    timezone: household.timezone,
    revision: household.revision,
    quarantineEnforced: household.quarantineEnforced,
    quarantineObservedEnabled: live.observedEnabled,
    quarantinePolicyCount: live.policyCount,
    displayName: household.displayName,
    alertsRelay: household.alertsRelayEnabled,
    askTimeoutMinutes: household.askTimeoutMinutes,
    askWaitMinutes: household.askWaitMinutes,
    askAheadMinutes: household.askAheadMinutes,
  };
}

export async function getHouseholdSettings() {
  return publicHousehold(await loadHousehold());
}

export async function updateHouseholdSettings(input: {
  timezone?: string;
  displayName?: string;
  quarantineEnforced?: boolean;
  alertsRelay?: boolean;
  askTimeoutMinutes?: number;
  askWaitMinutes?: number;
  askAheadMinutes?: number;
}) {
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
    ...(input.alertsRelay !== undefined ? { alertsRelayEnabled: input.alertsRelay } : {}),
    ...(input.askTimeoutMinutes !== undefined ? { askTimeoutMinutes: input.askTimeoutMinutes } : {}),
    ...(input.askWaitMinutes !== undefined ? { askWaitMinutes: input.askWaitMinutes } : {}),
    ...(input.askAheadMinutes !== undefined ? { askAheadMinutes: input.askAheadMinutes } : {}),
  };
  // The same switch as the built-in quarantine rule's: turning it off ends a pause on it.
  const household =
    input.quarantineEnforced !== undefined
      ? await setQuarantineEnforced(input.quarantineEnforced, data)
      : await prisma().household.update({ where: { id: currentHouseholdId() }, data });
  // Turned off, nothing more leaves for the relay, including alerts already waiting.
  if (input.alertsRelay === false) await prisma().alertEvent.deleteMany({ where: { sentAt: null } });
  const change = await enqueueChange(input.quarantineEnforced !== undefined ? "quarantine" : "household");
  // Both schedules are kept in the household's time zone.
  if (input.timezone) {
    rescheduleUpstreamProbe();
    rescheduleAutoUpdate();
  }
  return { household: await publicHousehold(household), change };
}

/** The household's time zone, which every caller may read, a Watch included, which may not read household settings. */
/**
 * The household's time zone, and how long before a block FamilyFi Me's heads-up comes (and the
 * person can ask), as a session reads them.
 */
export async function sessionHousehold(): Promise<{ timezone: string; askAheadMinutes: number }> {
  const household = await prisma().household.findUnique({ where: { id: currentHouseholdId() }, select: { timezone: true, askAheadMinutes: true } });
  return { timezone: householdTimezone(household), askAheadMinutes: household?.askAheadMinutes ?? 5 };
}

export async function currentTimezone() {
  const household = await prisma().household.findUnique({ where: { id: currentHouseholdId() }, select: { timezone: true } });
  return householdTimezone(household);
}
