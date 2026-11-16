import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { createUpstreamCategory, listUpstreamCategories } from "@/server/upstream/categories";

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ categories: await listUpstreamCategories() }));
}

const CreateBody = z.object({
  label: z.string().min(1).max(60),
  monogram: z.string().min(1).max(4).optional(),
  domains: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, CreateBody, "Invalid category.");
    if (!parsed.ok) return parsed.response;
    return Response.json({ category: await createUpstreamCategory(parsed.data) }, { status: 201 });
  });
}
