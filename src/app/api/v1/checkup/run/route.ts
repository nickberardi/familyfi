import { checkupState, runCheckup } from "@/server/checkup";
import { withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { syncClient } from "@/server/reconciliation";
import { loadHousehold } from "@/server/household";

/** Check now: run the network checkup against the gateway and return what it found. It only reads. */
export async function POST(request: Request) {
  return withMutation(request, async () => {
    const household = await loadHousehold();
    if (household.connectionStatus === "unconfigured" || !household.unifiSiteId) {
      return jsonError(409, "unifi_not_configured", "Connect FamilyFi to UniFi in Settings first.");
    }
    await runCheckup(household, syncClient(household));
    return Response.json({ checkup: await checkupState() });
  });
}
