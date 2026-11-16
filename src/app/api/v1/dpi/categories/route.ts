import { withSession } from "@/server/guard";
import { CURATED_CATEGORY_CANDIDATES, CURATED_MAP_STATUS } from "@/server/unifi/curated-categories";
import { listDpi } from "@/server/unifi/dpi-catalog";

export async function GET(request: Request) {
  return withSession(request, async () => {
    const filter = new URL(request.url).searchParams.get("filter") ?? undefined;
    return Response.json({
      categories: await listDpi("categories", filter),
      curated: {
        status: CURATED_MAP_STATUS,
        candidates: CURATED_CATEGORY_CANDIDATES,
      },
    });
  });
}
