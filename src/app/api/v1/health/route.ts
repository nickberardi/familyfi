import { APP_VERSION } from "@/lib/version";
import { prisma } from "@/server/db";
import { ConfigurationError, demoModeEnabled, loadEnv } from "@/server/env";
import { gatewayHealth } from "@/server/gateway-health";
import { withSession } from "@/server/guard";
import { getUpdateCheckSnapshot } from "@/server/update-check";

export const dynamic = "force-dynamic";

type Readiness = { body: Record<string, unknown>; status: number };

function healthResponse({ body, status }: Readiness) {
  return Response.json(
    { ...body, update: getUpdateCheckSnapshot() },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function readiness(): Promise<Readiness> {
  try {
    loadEnv();
  } catch (error) {
    const message =
      error instanceof ConfigurationError
        ? error.message
        : "FamilyFi is missing required settings in .env.";
    return { body: { status: "degraded", db: "unconfigured", version: APP_VERSION, error: message }, status: 503 };
  }
  try {
    await prisma().$queryRaw`SELECT 1`;
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    // The demo seeds its household at every start, so without one it has nothing to show.
    if (!household && demoModeEnabled()) {
      return { body: { status: "degraded", db: "ok", version: APP_VERSION, error: "No household yet." }, status: 503 };
    }
    return {
      body: {
        status: "ok",
        db: "ok",
        version: APP_VERSION,
        revision: household?.revision ?? 0,
      },
      status: 200,
    };
  } catch {
    return { body: { status: "degraded", db: "error", version: APP_VERSION }, status: 503 };
  }
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
