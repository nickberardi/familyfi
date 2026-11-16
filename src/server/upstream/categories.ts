import { UpstreamSource } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { ApiError } from "../http";
import {
  assertCategoryDeletable,
  assertCategoryFound,
  checkIsFresh,
  diffDomains,
  normalizeDomains,
  publicUpstreamCategory,
  publicUpstreamCheck,
  slugifyCategoryLabel,
  suggestedMonogram,
} from "../upstream-categories";
import { refreshResolverContexts } from "./discovery";
import { probeCategory, probeEnabledCategories } from "./probe";
import { withUpstreamLock } from "./transaction";

/**
 * Reporting only. These categories never produce a UniFi policy, so nothing here
 * calls `enqueueChange` and no result carries a `change`.
 */

const WITH_CHILDREN = { domains: true, checks: true } as const;

/** What `POST /upstream/categories` may carry. */
export const UpstreamCategoryCreateBody = z.object({
  label: z.string().min(1).max(60),
  monogram: z.string().min(1).max(4).optional(),
  domains: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

/** What `PATCH /upstream/categories/{id}` may carry. `domains` is the whole active list, replacing what is there. */
export const UpstreamCategoryUpdateBody = z.object({
  label: z.string().min(1).max(60).optional(),
  monogram: z.string().min(1).max(4).optional(),
  enabled: z.boolean().optional(),
  domains: z.array(z.string()).optional(),
});

function categoryNotFound() {
  return new ApiError(404, "not_found", "Category not found.");
}

/** The refusal for whatever a category helper threw, with these for what it left unsaid. */
function refusal(error: unknown, code: string, message: string) {
  const thrown = error as { status?: number; code?: string; message?: string };
  return new ApiError(thrown.status ?? 400, thrown.code ?? code, thrown.message ?? message);
}

export async function listUpstreamCategories() {
  await refreshResolverContexts();
  const categories = await prisma().upstreamCategory.findMany({
    include: WITH_CHILDREN,
    orderBy: [{ source: "asc" }, { label: "asc" }],
  });
  return categories.map(publicUpstreamCategory);
}

export async function getUpstreamCategory(id: string) {
  await refreshResolverContexts();
  const category = await prisma().upstreamCategory.findUnique({ where: { id }, include: WITH_CHILDREN });
  if (!category) throw categoryNotFound();
  return publicUpstreamCategory(category);
}

export async function createUpstreamCategory(input: { label: string; monogram?: string; domains?: string[]; enabled?: boolean }) {
  let slug: string;
  let domains: string[];
  try {
    slug = slugifyCategoryLabel(input.label);
    domains = normalizeDomains(input.domains ?? []);
  } catch (error) {
    throw refusal(error, "invalid_request", "Invalid category.");
  }

  const category = await withUpstreamLock(async (tx) => {
    const taken = await tx.upstreamCategory.findUnique({ where: { slug }, select: { id: true } });
    if (taken) return null;

    return tx.upstreamCategory.create({
      data: {
        slug,
        label: input.label.trim(),
        monogram: (input.monogram ?? suggestedMonogram(input.label)).toUpperCase(),
        source: UpstreamSource.user,
        enabled: input.enabled ?? true,
        domains: {
          create: domains.map((domain) => ({ domain, source: UpstreamSource.user })),
        },
      },
      include: WITH_CHILDREN,
    });
  });
  if (!category) throw new ApiError(409, "slug_taken", "A category with that name already exists.");
  return publicUpstreamCategory(category);
}

/**
 * `domains` is the whole *active* list, replaced wholesale — the same shape as a rule's
 * `targetIds`. Including a struck-through seeded domain restores it; leaving one
 * out strikes it. Deliberately not add/remove sub-routes, so the client never has
 * to know which case a given edit is.
 */
export async function updateUpstreamCategory(id: string, input: { label?: string; monogram?: string; enabled?: boolean; domains?: string[] }) {
  const existing = await prisma().upstreamCategory.findUnique({ where: { id }, include: WITH_CHILDREN });
  if (!existing) throw categoryNotFound();

  // A seeded label follows the shipped seed on the next boot, so editing it here
  // would silently revert. Say so rather than accepting a write that will not last.
  if (existing.source === UpstreamSource.seed && input.label !== undefined) {
    throw new ApiError(409, "seed_category", "A built-in category's name follows FamilyFi updates and cannot be changed.");
  }

  let nextDomains: string[] | undefined;
  try {
    nextDomains = input.domains ? normalizeDomains(input.domains) : undefined;
  } catch (error) {
    throw refusal(error, "invalid_domain", "Invalid domain.");
  }

  if (nextDomains) {
    const diff = diffDomains(existing.domains, nextDomains);
    const now = new Date();
    await prisma().$transaction([
      ...(diff.insert.length
        ? [
            prisma().upstreamDomain.createMany({
              data: diff.insert.map((domain) => ({ categoryId: existing.id, domain, source: UpstreamSource.user })),
              skipDuplicates: true,
            }),
          ]
        : []),
      ...(diff.restore.length
        ? [prisma().upstreamDomain.updateMany({ where: { categoryId: existing.id, domain: { in: diff.restore } }, data: { removedAt: null } })]
        : []),
      ...(diff.tombstone.length
        ? [prisma().upstreamDomain.updateMany({ where: { categoryId: existing.id, domain: { in: diff.tombstone } }, data: { removedAt: now } })]
        : []),
      ...(diff.delete.length
        ? [prisma().upstreamDomain.deleteMany({ where: { categoryId: existing.id, domain: { in: diff.delete }, source: UpstreamSource.user } })]
        : []),
    ]);
  }

  const category = await withUpstreamLock(async (tx) => {
    if (input.enabled === false) await tx.upstreamCheck.deleteMany({ where: { categoryId: id } });
    return tx.upstreamCategory.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.monogram !== undefined ? { monogram: input.monogram.toUpperCase() } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.enabled === false ? { disabledAt: new Date() } : {}),
      },
      include: WITH_CHILDREN,
    });
  });
  return publicUpstreamCategory(category);
}

export async function deleteUpstreamCategory(id: string) {
  const category = await prisma().upstreamCategory.findUnique({ where: { id }, include: WITH_CHILDREN });
  try {
    assertCategoryFound(category);
    assertCategoryDeletable(category);
  } catch (error) {
    throw refusal(error, "invalid_request", "Cannot delete.");
  }
  // Domains and the check row cascade.
  await prisma().upstreamCategory.delete({ where: { id } });
}

/**
 * The design's per-category "Check now". Always answers with the resulting
 * verdict, including `unknown` when the resolver could not be reached — a failed
 * sweep is a result to show, not a request that errored.
 */
export async function checkUpstreamCategory(id: string) {
  const exists = await prisma().upstreamCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw categoryNotFound();

  await probeCategory(id);
  const category = await prisma().upstreamCategory.findUnique({ where: { id }, include: WITH_CHILDREN });
  if (!category) throw categoryNotFound();
  return publicUpstreamCategory(category);
}

/** Latest verdict per category, without the domain lists. */
export async function listUpstreamChecks() {
  await refreshResolverContexts();
  const checks = await prisma().upstreamCheck.findMany({
    include: { category: { select: { slug: true, label: true } } },
    orderBy: { checkedAt: "desc" },
  });
  return checks
    .filter((check) => checkIsFresh(check))
    .map((check) => ({ categoryId: check.categoryId, slug: check.category.slug, label: check.category.label, ...publicUpstreamCheck(check) }));
}

/** One sweep over every category with checking on. Disabled ones keep their result. */
export async function runUpstreamChecks() {
  const outcomes = await probeEnabledCategories();
  return outcomes.map((outcome) => ({
    categoryId: outcome.categoryId,
    slug: outcome.slug,
    verdict: outcome.verdict,
    blockedCount: outcome.blockedCount,
    totalCount: outcome.totalCount,
  }));
}
