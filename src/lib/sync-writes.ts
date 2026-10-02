import type { HouseholdStore } from "./household-store";

type Mutate = HouseholdStore["mutate"];

/** Ask for a reconcile sweep now: the status card's Reconcile now. Resolves undefined when it failed. */
export function reconcileNow(mutate: Mutate) {
  return mutate((send) => send("/api/v1/sync/retry", { method: "POST", body: {} }));
}
