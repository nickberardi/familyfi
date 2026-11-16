import type { Household } from "@prisma/client";
import { checkupState, runCheckup } from "./checkup";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { removeLeftoverPolicies } from "./leftover-policies";
import { LockLostError, syncClient, withReconcileLock } from "./reconciliation";

class SyncRunning extends Error {}

async function connectedHousehold(): Promise<Household & { unifiSiteId: string }> {
  const household = await loadHousehold();
  if (household.connectionStatus === "unconfigured" || !household.unifiSiteId) {
    throw new ApiError(409, "unifi_not_configured", "Connect FamilyFi to UniFi in Settings first.");
  }
  return household as Household & { unifiSiteId: string };
}

/** Check now: run the network checkup against the gateway and return what it found. It only reads. */
export async function runCheckupNow() {
  const household = await connectedHousehold();
  await runCheckup(household, syncClient(household));
  return checkupState();
}

/**
 * Remove leftover FamilyFi policies the administrator ticked and confirmed on Checkup. Each one is
 * checked against the gateway again first: one that is gone, renamed or now FamilyFi's own is
 * skipped, never deleted; one the gateway refuses to delete is `failed`. Then the checkup runs again
 * so the finding follows.
 */
export async function removeConfirmedLeftovers(policyIds: string[]) {
  const household = await connectedHousehold();
  const client = syncClient(household);
  let result;
  try {
    // No sync pass may record, create or delete a policy while the leftovers are checked and removed.
    result = await withReconcileLock((stillHeld) => removeLeftoverPolicies(household, client, policyIds, stillHeld), {
      waitMs: 20_000,
      busy: () => new SyncRunning(),
    });
  } catch (error) {
    // Waiting, or overtaken partway: a sync pass has the gateway. Nothing more is deleted.
    if (error instanceof SyncRunning || error instanceof LockLostError) {
      await runCheckup(household, client).catch(() => undefined);
      throw new ApiError(409, "sync_running", "A sync with the gateway is still running. Check again in a minute.");
    }
    throw error;
  }
  await runCheckup(household, client);
  return { checkup: await checkupState(), ...result };
}
