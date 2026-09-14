import { prisma } from "@/server/db";
import { ConfigurationError, loadEnv } from "@/server/env";

export async function GET() {
  try {
    loadEnv();
  } catch (error) {
    const message =
      error instanceof ConfigurationError
        ? error.message
        : "FamilyFi is missing required settings in .env.";
    return Response.json({ status: "degraded", db: "unconfigured", error: message }, { status: 503 });
  }
  try {
    await prisma().$queryRaw`SELECT 1`;
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    return Response.json({
      status: "ok",
      db: "ok",
      revision: household?.revision ?? 0,
    });
  } catch {
    return Response.json({ status: "degraded", db: "error" }, { status: 503 });
  }
}
