import { AsyncLocalStorage } from "node:async_hooks";

/** The household a self-hosted deployment serves: its only one. */
export const DEFAULT_HOUSEHOLD_ID = "default";

const household = new AsyncLocalStorage<string>();

/**
 * Runs work, and everything it awaits or starts, as one household. Server code never names a
 * household itself; it asks `currentHouseholdId()`, so a shared server can choose the household
 * once per request or background pass (issue 374).
 */
export function withHousehold<T>(householdId: string, work: () => Promise<T>): Promise<T> {
  return household.run(householdId, work);
}

/** The household this request or pass acts on; outside `withHousehold`, the default one. */
export function currentHouseholdId(): string {
  return household.getStore() ?? DEFAULT_HOUSEHOLD_ID;
}
