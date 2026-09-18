import { UpstreamSource } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { withUpstreamLock } from "@/server/upstream/transaction";
import {
  normalizeDomains,
  publicUpstreamCategory,
  slugifyCategoryLabel,
  suggestedMonogram,
} from "@/server/upstream-categories";

/**
 * Reporting only. These categories never produce a UniFi policy, so no route here
 * calls `enqueueChange` and no response carries a `change` envelope.
 */
export async function GET(request: Request) {
  return withSession(request, async () => {
    const categories = await prisma().upstreamCategory.findMany({
      include: { domains: true, checks: true },
      orderBy: [{ source: "asc" }, { label: "asc" }],
    });
    return Response.json({ categories: categories.map(publicUpstreamCategory) });
  });
}

const CreateBody = z.object({
  label: z.string().min(1).max(60),
  monogram: z.string().min(1).max(3).optional(),
  domains: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = CreateBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid category.");

    let slug: string;
    let domains: string[];
    try {
      slug = slugifyCategoryLabel(parsed.data.label);
      domains = normalizeDomains(parsed.data.domains ?? []);
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      return jsonError(err.status ?? 400, err.code ?? "invalid_request", err.message ?? "Invalid category.");
    }

    const category = await withUpstreamLock(async (tx) => {
      const taken = await tx.upstreamCategory.findUnique({ where: { slug }, select: { id: true } });
      if (taken) return null;

      return tx.upstreamCategory.create({
        data: {
          slug,
          label: parsed.data.label.trim(),
          monogram: (parsed.data.monogram ?? suggestedMonogram(parsed.data.label)).toUpperCase(),
          source: UpstreamSource.user,
          enabled: parsed.data.enabled ?? true,
          domains: {
            create: domains.map((domain) => ({ domain, source: UpstreamSource.user })),
          },
        },
        include: { domains: true, checks: true },
      });
    });
    if (!category) return jsonError(409, "slug_taken", "A category with that name already exists.");
    return Response.json({ category: publicUpstreamCategory(category) }, { status: 201 });
  });
}
