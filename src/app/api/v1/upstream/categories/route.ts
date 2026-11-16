import { readBody, withMutation, withSession } from "@/server/guard";
import { createUpstreamCategory, listUpstreamCategories, UpstreamCategoryCreateBody } from "@/server/upstream/categories";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ categories: await listUpstreamCategories() }));
}

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, UpstreamCategoryCreateBody, "Invalid category.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ category: await createUpstreamCategory(parsed.data) }, { status: 201 });
  });
}
