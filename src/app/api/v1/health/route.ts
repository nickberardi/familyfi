import { APP_VERSION } from "@/lib/version";
import { prisma } from "@/server/db";
import { ConfigurationError, loadEnv } from "@/server/env";
import { getUpdateCheckSnapshot } from "@/server/update-check";

export const dynamic = "force-dynamic";

function healthResponse(body: Record<string, unknown>, status: number) {
  return Response.json(
    { ...body, update: getUpdateCheckSnapshot() },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET() {
  try {
    loadEnv();
  } catch (error) {
    const message =
      error instanceof ConfigurationError
        ? error.message
        : "FamilyFi is missing required settings in .env.";
    return healthResponse({ status: "degraded", db: "unconfigured", version: APP_VERSION, error: message }, 503);
  }
  try {
    await prisma().$queryRaw`SELECT 1`;
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    return healthResponse(
      {
        status: "ok",
        db: "ok",
        version: APP_VERSION,
        revision: household?.revision ?? 0,
      },
      200,
    );
  } catch {
    return healthResponse({ status: "degraded", db: "error", version: APP_VERSION }, 503);
  }
}
