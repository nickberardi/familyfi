import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold } from "@/server/unifi/connection";
import { UnifiConfigError } from "@/server/unifi/errors";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    if (!household || household.connectionStatus === "unconfigured") {
      return jsonError(409, "unifi_unconfigured", "Configure UniFi in Settings before listing DPI applications.");
    }
    try {
      const client = clientForHousehold(household);
      const url = new URL(request.url);
      const filter = url.searchParams.get("filter") ?? undefined;
      const applications = await client.listDpiApplications(filter);
      return Response.json({ applications });
    } catch (error) {
      if (error instanceof UnifiConfigError) {
        return jsonError(409, "unifi_unconfigured", error.message);
      }
      throw error;
    }
  });
}
