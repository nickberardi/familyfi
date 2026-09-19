import { UpstreamSource, type UpstreamCategory, type UpstreamCheck, type UpstreamDomain } from "@prisma/client";
import { probeCostNote } from "@/lib/upstream-domains";

export type PublicUpstreamDomain = {
  id: string;
  domain: string;
  source: "seed" | "user";
  /** A seeded domain the household took out. Rendered struck through, restorable. */
  removed: boolean;
};

export type PublicUpstreamDomainResult = {
  domain: string;
  /** Null means this domain could not be resolved — unknown, never "not blocked". */
  blocked: boolean | null;
};

export type PublicUpstreamCheck = {
  verdict: "blocked" | "partial" | "open" | "unknown";
  blockedCount: number;
  totalCount: number;
  checkedAt: string;
  error: string | null;
  /** Null is the household default; a group id is that group's own resolver. */
  groupId: string | null;
  /** One entry per domain probed in this sweep. Domains removed since are absent. */
  results: PublicUpstreamDomainResult[];
};

export type PublicUpstreamCategory = {
  id: string;
  slug: string;
  label: string;
  monogram: string;
  source: "seed" | "user";
  enabled: boolean;
  domains: PublicUpstreamDomain[];
  activeDomainCount: number;
  costNote: string;
  /**
   * Every verdict measured for this category — the household default plus one per
   * group with its own resolver. The caller picks with `effectiveCheck` rather than
   * the server guessing a context, so the rule lives in exactly one function.
   */
  checks: PublicUpstreamCheck[];
};

type CategoryWithChildren = UpstreamCategory & {
  domains: UpstreamDomain[];
  checks?: UpstreamCheck[];
};

/**
 * Removed domains are included on purpose: the customer needs to see what they took
 * out of a seeded list in order to put it back.
 */
export function publicUpstreamCategory(category: CategoryWithChildren): PublicUpstreamCategory {
  const domains = [...category.domains]
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      source: domain.source === UpstreamSource.seed ? ("seed" as const) : ("user" as const),
      removed: domain.removedAt !== null,
    }));
  const activeDomainCount = domains.filter((domain) => !domain.removed).length;
  return {
    id: category.id,
    slug: category.slug,
    label: category.label,
    monogram: category.monogram,
    source: category.source === UpstreamSource.seed ? "seed" : "user",
    enabled: category.enabled,
    domains,
    activeDomainCount,
    costNote: probeCostNote(activeDomainCount),
    checks: (category.checks ?? []).map(publicUpstreamCheck),
  };
}

/**
 * `results` is stored as `Json`, so it comes back untyped. Parsed defensively rather
 * than cast: a malformed or legacy row should render as "nothing measured" for that
 * domain, not throw or silently claim a shape it does not have.
 */
function parseDomainResults(value: unknown): PublicUpstreamDomainResult[] {
  if (!Array.isArray(value)) return [];
  const results: PublicUpstreamDomainResult[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { domain?: unknown }).domain === "string" &&
      (typeof (item as { blocked?: unknown }).blocked === "boolean" ||
        (item as { blocked?: unknown }).blocked === null)
    ) {
      results.push({
        domain: (item as { domain: string }).domain,
        blocked: (item as { blocked: boolean | null }).blocked,
      });
    }
  }
  return results;
}

export function publicUpstreamCheck(check: UpstreamCheck): PublicUpstreamCheck {
  return {
    verdict: check.verdict,
    blockedCount: check.blockedCount,
    totalCount: check.totalCount,
    checkedAt: check.checkedAt.toISOString(),
    error: check.error,
    groupId: check.groupId,
    results: parseDomainResults(check.results),
  };
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function invalidDomain(message: string): never {
  throw Object.assign(new Error(message), { code: "invalid_domain", status: 400 });
}

/**
 * A bare, lowercase hostname. A pasted URL is reduced to its host, since that is the
 * common mistake and the intent is unambiguous; anything else is rejected with a
 * message rather than silently reinterpreted.
 */
export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) invalidDomain("Enter a domain.");
  if (value.includes("://")) value = value.slice(value.indexOf("://") + 3);
  const slash = value.indexOf("/");
  if (slash >= 0) value = value.slice(0, slash);
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (value.startsWith("*.")) {
    invalidDomain("Wildcards are not supported — add the domain itself.");
  }
  if (value.includes("@")) invalidDomain("Enter a domain, not an email address.");
  if (value.includes(":")) invalidDomain("Leave the port off — just the domain.");
  if (/\s/.test(value)) invalidDomain("A domain cannot contain spaces.");
  if (value.length > 253) invalidDomain("That domain is too long.");
  if (!HOSTNAME.test(value)) invalidDomain(`"${raw.trim()}" is not a domain.`);
  if (value.split(".").some((label) => label.length > 63)) {
    invalidDomain("That domain has a part that is too long.");
  }
  return value;
}

/** Deduped and sorted, mirroring how rule target and network arrays are handled. */
export function normalizeDomains(raw: string[]): string[] {
  return [...new Set(raw.map(normalizeDomain))].sort();
}

export function slugifyCategoryLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw Object.assign(new Error("Give the category a name."), {
      code: "invalid_request",
      status: 400,
    });
  }
  return slug;
}

/** The placeholder the New category sheet offers — first two letters, uppercased. */
export function suggestedMonogram(label: string): string {
  const letters = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "NEW";
}

export function assertCategoryFound(
  category: CategoryWithChildren | null,
): asserts category is CategoryWithChildren {
  if (!category) {
    throw Object.assign(new Error("Category not found."), { code: "not_found", status: 404 });
  }
}

/**
 * A seeded category cannot be deleted: the boot reconcile would recreate it on the
 * next restart, so the delete would look like it worked and then silently undo
 * itself. Turning checking off is the supported way to retire one.
 */
export function assertCategoryDeletable(category: UpstreamCategory): void {
  if (category.source === UpstreamSource.seed) {
    throw Object.assign(
      new Error("Built-in categories cannot be deleted. Turn checking off instead."),
      { code: "seed_category", status: 409 },
    );
  }
}

export type DomainDiff = {
  insert: string[];
  restore: string[];
  tombstone: string[];
  delete: string[];
};

/**
 * Resolve a whole-array replacement of the *active* domain list against what is
 * stored, mirroring how rule `targetIds` are replaced wholesale.
 *
 * The asymmetry is the product decision: a seeded domain that drops out of the list
 * is struck through and kept, so it can be restored by including it again, while a
 * customer's own domain is deleted because there is nothing to restore it to.
 */
export function diffDomains(existing: UpstreamDomain[], nextActive: string[]): DomainDiff {
  const wanted = new Set(nextActive);
  const byDomain = new Map(existing.map((domain) => [domain.domain, domain]));
  const diff: DomainDiff = { insert: [], restore: [], tombstone: [], delete: [] };

  for (const domain of nextActive) {
    const row = byDomain.get(domain);
    if (!row) diff.insert.push(domain);
    else if (row.removedAt !== null) diff.restore.push(domain);
  }

  for (const row of existing) {
    if (wanted.has(row.domain)) continue;
    if (row.source === UpstreamSource.seed) {
      if (row.removedAt === null) diff.tombstone.push(row.domain);
    } else {
      diff.delete.push(row.domain);
    }
  }

  return diff;
}
