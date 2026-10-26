import { z } from "zod";
import { checkupState, runCheckup } from "@/server/checkup";
import { prisma } from "@/server/db";
import { readJson, withAdmin } from "@/server/guard";
import { jsonError } from "@/server/http";
import { removeLeftoverPolicies } from "@/server/leftover-policies";
import { syncClient } from "@/server/reconciliation";

const Body = z.object({ policyIds: z.array(z.string().min(1).max(200)).min(1).max(200) });

/**
 * Remove leftover FamilyFi policies the administrator ticked and confirmed on Checkup. Each one is
 * checked against the gateway again first: one that is gone, renamed or now FamilyFi's own is
 * skipped, never deleted. Then the checkup runs again so the finding follows.
 */
export async function POST(request: Request) {
  return withAdmin(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "policyIds must list the policies to remove.");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    if (household.connectionStatus === "unconfigured" || !household.unifiSiteId) {
      return jsonError(409, "unifi_not_configured", "Connect FamilyFi to UniFi in Settings first.");
    }
    const client = syncClient(household);
    const { removed, skipped } = await removeLeftoverPolicies(household, client, parsed.data.policyIds);
    await runCheckup(household, client);
    return Response.json({ checkup: await checkupState(), removed, skipped });
  });
}
