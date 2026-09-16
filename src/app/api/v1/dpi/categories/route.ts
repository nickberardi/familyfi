import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { clientForHousehold } from "@/server/unifi/connection";
import { D6_CATEGORY_CANDIDATES, D6_MAP_STATUS, D6_OPTIONAL_ADULT_TOPSITES } from "@/server/unifi/d6-categories";
import { UnifiConfigError } from "@/server/unifi/errors";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUnique({ where: { id: "default" } });
    if (!household || household.connectionStatus === "unconfigured") {
      return jsonError(409, "unifi_unconfigured", "Configure UniFi in Settings before listing DPI categories.");
    }
    try {
      const client = clientForHousehold(household);
      const url = new URL(request.url);
      const filter = url.searchParams.get("filter") ?? undefined;
      const categories = await client.listDpiCategories(filter);
      return Response.json({
        categories,
        d6: {
          status: D6_MAP_STATUS,
          candidates: D6_CATEGORY_CANDIDATES,
          optionalAdultTopsites: D6_OPTIONAL_ADULT_TOPSITES,
        },
      });
    } catch (error) {
      if (error instanceof UnifiConfigError) {
        return jsonError(409, "unifi_unconfigured", error.message);
      }
      throw error;
    }
  });
}
