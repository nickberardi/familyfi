import { UpstreamSource } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import {
  assertCategoryDeletable,
  assertCategoryFound,
  diffDomains,
  normalizeDomains,
  publicUpstreamCategory,
} from "@/server/upstream-categories";

type Ctx = { params: Promise<{ id: string }> };

const WITH_CHILDREN = { domains: true, check: true } as const;

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { id } = await ctx.params;
    const category = await prisma().upstreamCategory.findUnique({
      where: { id },
      include: WITH_CHILDREN,
    });
    if (!category) return jsonError(404, "not_found", "Category not found.");
    return Response.json({ category: publicUpstreamCategory(category) });
  });
}

const PatchBody = z.object({
  label: z.string().min(1).max(60).optional(),
  monogram: z.string().min(1).max(3).optional(),
  enabled: z.boolean().optional(),
  /**
   * The whole *active* list, replaced wholesale — the same shape as a rule's
   * `targetIds`. Including a struck-through seeded domain restores it; leaving one
   * out strikes it. Deliberately not add/remove sub-routes, so the client never has
   * to know which case a given edit is.
   */
  domains: z.array(z.string()).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = PatchBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid category update.");

    const existing = await prisma().upstreamCategory.findUnique({
      where: { id },
      include: WITH_CHILDREN,
    });
    if (!existing) return jsonError(404, "not_found", "Category not found.");

    // A seeded label follows the shipped seed on the next boot, so editing it here
    // would silently revert. Say so rather than accepting a write that will not last.
    if (existing.source === UpstreamSource.seed && parsed.data.label !== undefined) {
      return jsonError(
        409,
        "seed_category",
        "A built-in category's name follows FamilyFi updates and cannot be changed.",
      );
    }

    let nextDomains: string[] | undefined;
    try {
      nextDomains = parsed.data.domains ? normalizeDomains(parsed.data.domains) : undefined;
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      return jsonError(err.status ?? 400, err.code ?? "invalid_domain", err.message ?? "Invalid domain.");
    }

    if (nextDomains) {
      const diff = diffDomains(existing.domains, nextDomains);
      const now = new Date();
      await prisma().$transaction([
        ...(diff.insert.length
          ? [
              prisma().upstreamDomain.createMany({
                data: diff.insert.map((domain) => ({
                  categoryId: existing.id,
                  domain,
                  source: UpstreamSource.user,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
        ...(diff.restore.length
          ? [
              prisma().upstreamDomain.updateMany({
                where: { categoryId: existing.id, domain: { in: diff.restore } },
                data: { removedAt: null },
              }),
            ]
          : []),
        ...(diff.tombstone.length
          ? [
              prisma().upstreamDomain.updateMany({
                where: { categoryId: existing.id, domain: { in: diff.tombstone } },
                data: { removedAt: now },
              }),
            ]
          : []),
        ...(diff.delete.length
          ? [
              prisma().upstreamDomain.deleteMany({
                where: {
                  categoryId: existing.id,
                  domain: { in: diff.delete },
                  source: UpstreamSource.user,
                },
              }),
            ]
          : []),
      ]);
    }

    const category = await prisma().upstreamCategory.update({
      where: { id },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label.trim() } : {}),
        ...(parsed.data.monogram !== undefined
          ? { monogram: parsed.data.monogram.toUpperCase() }
          : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      },
      include: WITH_CHILDREN,
    });
    return Response.json({ category: publicUpstreamCategory(category) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { id } = await ctx.params;
    const category = await prisma().upstreamCategory.findUnique({
      where: { id },
      include: WITH_CHILDREN,
    });
    try {
      assertCategoryFound(category);
      assertCategoryDeletable(category);
    } catch (error) {
      const err = error as { status?: number; code?: string; message?: string };
      return jsonError(err.status ?? 400, err.code ?? "invalid_request", err.message ?? "Cannot delete.");
    }
    // Domains and the check row cascade.
    await prisma().upstreamCategory.delete({ where: { id } });
    return Response.json({ ok: true });
  });
}
