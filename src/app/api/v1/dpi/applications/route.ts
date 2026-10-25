import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold, connectionIdentity } from "@/server/unifi/connection";
import { dpiCatalog } from "@/server/unifi/dpi-catalog";
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
      // A filtered search asks the gateway; the whole catalog is shared.
      const applications = filter ? await client.listDpiApplications(filter) : await dpiCatalog(connectionIdentity(household), "applications", client);
      return Response.json({ applications });
    } catch (error) {
      if (error instanceof UnifiConfigError) {
        return jsonError(409, "unifi_unconfigured", error.message);
      }
      throw error;
    }
  });
}
