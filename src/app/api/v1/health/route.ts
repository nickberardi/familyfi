import { prisma } from "@/server/db";
import { loadEnv } from "@/server/env";

export async function GET() {
  try {
    loadEnv();
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
