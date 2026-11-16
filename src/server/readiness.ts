import { APP_VERSION } from "@/lib/version";
import { prisma } from "./db";
import { ConfigurationError, demoModeEnabled, loadEnv } from "./env";

export type Readiness = { body: Record<string, unknown>; status: number };

/** Whether this server can serve: its settings load, the database answers, and the demo has its household. */
export async function readiness(): Promise<Readiness> {
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
