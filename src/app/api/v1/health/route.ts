import { API_VERSION, MIN_APP_API_VERSION, MIN_WATCH_API_VERSION } from "@/lib/api-compat";
import { gatewayHealth } from "@/server/gateway-health";
import { withSession } from "@/server/guard";
import { readiness, type Readiness } from "@/server/readiness";
import { getUpdateCheckSnapshot } from "@/server/update-check";

export const dynamic = "force-dynamic";

// Every answer, degraded or not, says which contract it speaks, so a client can tell an update
// from an outage (src/lib/api-compat.ts).
function healthResponse({ body, status }: Readiness) {
  return Response.json(
    {
      ...body,
      apiVersion: API_VERSION,
      minAppApiVersion: MIN_APP_API_VERSION,
      minWatchApiVersion: MIN_WATCH_API_VERSION,
      update: getUpdateCheckSnapshot(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("gateway") !== "true") return healthResponse(await readiness());
  // The gateway's readings name the household's UniFi devices and cost the console a request per
  // device, so they take a session and are never part of the public readiness check others poll.
  return withSession(request, async () => {
    const ready = await readiness();
    if (ready.status !== 200) return healthResponse(ready);
    return healthResponse({ ...ready, body: { ...ready.body, gateway: await gatewayHealth() } });
  });
}
