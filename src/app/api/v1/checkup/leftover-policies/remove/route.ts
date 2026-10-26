import { z } from "zod";
import { checkupState, runCheckup } from "@/server/checkup";
import { prisma } from "@/server/db";
import { demoLocked } from "@/server/demo";
import { readJson, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { removeLeftoverPolicies } from "@/server/leftover-policies";
import { syncClient, withReconcileLock } from "@/server/reconciliation";

class SyncRunning extends Error {}

const Body = z.object({ policyIds: z.array(z.string().min(1).max(200)).min(1).max(200) });

/**
 * Remove leftover FamilyFi policies the administrator ticked and confirmed on Checkup. Each one is
 * checked against the gateway again first: one that is gone, renamed or now FamilyFi's own is
 * skipped, never deleted; one the gateway refuses to delete is `failed`. Then the checkup runs again
 * so the finding follows. Locked in the demo, whose visitors share one gateway.
 */
export async function POST(request: Request) {
  return withAdmin(request, async () => {
    // Every demo visitor shares one gateway.
    const locked = demoLocked();
    if (locked) return locked;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "policyIds must list the policies to remove.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
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
      if (error instanceof SyncRunning) return jsonError(409, "sync_running", "A sync with the gateway is still running. Try again in a minute.");
      throw error;
    }
    await runCheckup(household, client);
    return Response.json({ checkup: await checkupState(), ...result });
  });
}
