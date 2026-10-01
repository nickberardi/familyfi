/**
 * The categories and apps a rule can block, from the gateway's own DPI catalogs: a search asks the
 * catalog (`?filter=`) for matches, so whatever the gateway supports can be found.
 */
import type { ApiRequest } from "./api-client";
import { CURATED_CATEGORY_SLOTS } from "./rules";

export type CatalogItem = { id: number; name: string };
export type CatalogKind = "category" | "app";

/** Where each kind of rule finds what it can block. */
export const CATALOG_SOURCES = {
  category: { path: "/api/v1/dpi/categories", key: "categories", noun: "category", nouns: "categories" },
  app: { path: "/api/v1/dpi/applications", key: "applications", noun: "app", nouns: "apps" },
} as const;

/** The catalog's entries matching a search; an empty search lists them all. */
export function searchCatalog(request: ApiRequest, kind: CatalogKind, filter: string): Promise<CatalogItem[]> {
  const source = CATALOG_SOURCES[kind];
  return request<Record<string, CatalogItem[] | undefined>>(`${source.path}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`).then(
    (res) => res[source.key] ?? [],
  );
}

/** The most matches a search shows. */
export const CATALOG_RESULTS_SHOWN = 30;

/** The curated categories a search matches by their familiar name: the gateway knows "Video" as "Media streaming". */
export function catalogFamiliar(kind: CatalogKind, filter: string): CatalogItem[] {
  const query = filter.trim().toLowerCase();
  if (kind !== "category" || !query) return [];
  return CURATED_CATEGORY_SLOTS.filter((item) => item.label.toLowerCase().includes(query)).map((item) => ({ id: item.categoryId, name: item.catalogName }));
}

/** What a search offers to add: familiar names first, then the catalog's answers, never one already picked. */
export function catalogMatches(kind: CatalogKind, filter: string, found: CatalogItem[], targetIds: number[]): CatalogItem[] {
  const familiar = catalogFamiliar(kind, filter);
  return [...familiar, ...found.filter((item) => !familiar.some((known) => known.id === item.id))].filter((item) => !targetIds.includes(item.id));
}

export function catalogCopy(kind: CatalogKind) {
  const { nouns } = CATALOG_SOURCES[kind];
  return {
    search: `Search ${nouns}`,
    placeholder: `Search the gateway’s ${nouns}`,
    matches: `Matching ${nouns}`,
    none: (filter: string) => `No ${nouns} match “${filter}”.`,
    failed: `Couldn’t search the gateway’s ${nouns}.`,
    note: `Search what the gateway can detect, and pick as many ${nouns} as the rule should block.`,
  } as const;
}
