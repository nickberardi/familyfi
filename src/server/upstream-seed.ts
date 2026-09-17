import { UpstreamSource } from "@prisma/client";
import {
  UPSTREAM_CATEGORY_DOMAINS,
  UPSTREAM_SEED_CATEGORIES,
  type UpstreamSeedCategory,
} from "@/lib/upstream-domains";
import { prisma } from "./db";

/**
 * Reconcile the shipped seed in `src/lib/upstream-domains.ts` against the database.
 *
 * This runs on every boot, beside `ensureRecoveryAccount()`, because it is the only
 * place a real deployment creates app-owned rows — `dev-seed.ts` is `UNIFI_MOCK` only
 * and a migration cannot import the seed module. Running it every boot is also what
 * makes a release's new canary domains arrive in an existing household.
 *
 * What it will and will not touch:
 *
 * - A missing seed category is created; its label and monogram then follow the seed
 *   on every boot, so renaming a category in a release reaches existing households.
 * - A missing seed domain is inserted active. **This is how an upgrade delivers new
 *   domains.**
 * - A seed domain the household removed keeps its `removedAt`. Re-adding it here
 *   would silently undo a deliberate edit on the next restart.
 * - A seed domain that has since left the shipped seed is left alone rather than
 *   deleted: retiring a canary should not remove a domain a household relies on.
 * - Nothing with `source: user` is read or written. Custom categories and
 *   customer-added domains are theirs.
 *
 * Deliberately does not call `enqueueChange`. These rows never produce a UniFi
 * policy, and a `ChangeResult` would sit `pending` forever while UniFi is
 * unconfigured (`reconciliation.ts` bails before settling anything).
 */
export async function ensureUpstreamCategories(): Promise<void> {
  for (const seed of UPSTREAM_SEED_CATEGORIES) {
    await ensureSeedCategory(seed);
  }
}

async function ensureSeedCategory(seed: UpstreamSeedCategory): Promise<void> {
  const category = await prisma().upstreamCategory.upsert({
    where: { slug: seed.slug },
    // Label and monogram follow the seed; `enabled` and membership do not.
    update: { label: seed.label, monogram: seed.monogram, source: UpstreamSource.seed },
    create: {
      slug: seed.slug,
      label: seed.label,
      monogram: seed.monogram,
      source: UpstreamSource.seed,
    },
    select: { id: true },
  });

  const seeded = UPSTREAM_CATEGORY_DOMAINS[seed.slug];
  if (seeded.length === 0) return;

  const existing = await prisma().upstreamDomain.findMany({
    where: { categoryId: category.id, domain: { in: [...seeded] } },
    select: { domain: true },
  });
  const known = new Set(existing.map((row) => row.domain));
  const missing = seeded.filter((domain) => !known.has(domain));
  if (missing.length === 0) return;

  await prisma().upstreamDomain.createMany({
    data: missing.map((domain) => ({
      categoryId: category.id,
      domain,
      source: UpstreamSource.seed,
    })),
    // A concurrent boot may have inserted the same row between the read and the write.
    skipDuplicates: true,
  });
}
