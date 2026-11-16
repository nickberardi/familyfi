import { z } from "zod";
import { checkupState, runCheckup } from "@/server/checkup";
import { readBody, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { removeLeftoverPolicies } from "@/server/leftover-policies";
import { LockLostError, syncClient, withReconcileLock } from "@/server/reconciliation";
import { loadHousehold } from "@/server/household";

class SyncRunning extends Error {}

const Body = z.object({ policyIds: z.array(z.string().min(1).max(200)).min(1).max(200) });

/**
 * Remove leftover FamilyFi policies the administrator ticked and confirmed on Checkup. Each one is
 * checked against the gateway again first: one that is gone, renamed or now FamilyFi's own is
 * skipped, never deleted; one the gateway refuses to delete is `failed`. Then the checkup runs again
 * so the finding follows. Locked in the demo, whose visitors share one gateway.
 */
export async function POST(request: Request) {
  // Every demo visitor shares one gateway.
  return withAdmin(request, async () => {
    const parsed = await readBody(request, Body, "policyIds must list the policies to remove.");
    if (!parsed.ok) return parsed.response;
    const household = await loadHousehold();
    if (household.connectionStatus === "unconfigured" || !household.unifiSiteId) {
      return jsonError(409, "unifi_not_configured", "Connect FamilyFi to UniFi in Settings first.");
    }
    const client = syncClient(household);
    let result;
    try {
      // No sync pass may record, create or delete a policy while the leftovers are checked and removed.
      result = await withReconcileLock((stillHeld) => removeLeftoverPolicies(household, client, parsed.data.policyIds, stillHeld), {
        waitMs: 20_000,
        busy: () => new SyncRunning(),
      });
    } catch (error) {
      // Waiting, or overtaken partway: a sync pass has the gateway. Nothing more is deleted.
      if (error instanceof SyncRunning || error instanceof LockLostError) {
        await runCheckup(household, client).catch(() => undefined);
        return jsonError(409, "sync_running", "A sync with the gateway is still running. Check again in a minute.");
      }
      throw error;
    }
    await runCheckup(household, client);
    return Response.json({ checkup: await checkupState(), ...result });
  }, { demoLock: true });
}
