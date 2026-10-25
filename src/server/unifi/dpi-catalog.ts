import type { DpiCatalogItem } from "./types";
import type { UnifiClient } from "./client";

/**
 * The gateway's app and category catalog changes only with its firmware, yet every Family, Things,
 * group and Rules page asks for it, and the gateway pages it out 200 items at a time. One read per
 * console is shared for this long; a failed read is not kept.
 */
export const DPI_CATALOG_MS = 60 * 60_000;

type Kind = "categories" | "applications";
type Entry = { items: Promise<DpiCatalogItem[]>; at: number };
type Cache = Map<string, Entry>;

// Next.js bundles each route handler separately; they share this.
const cache: Cache = ((globalThis as { familyfiDpiCatalog?: Cache }).familyfiDpiCatalog ??= new Map());

/** The whole catalog of one kind for this console, read from the gateway at most once an hour. */
export function dpiCatalog(identity: string, kind: Kind, client: UnifiClient, now = Date.now()): Promise<DpiCatalogItem[]> {
  const key = `${kind}:${identity}`;
  const entry = cache.get(key);
  if (entry && now - entry.at <= DPI_CATALOG_MS) return entry.items;
  const items = kind === "categories" ? client.listDpiCategories() : client.listDpiApplications();
  cache.set(key, { items, at: now });
  items.catch(() => {
    if (cache.get(key)?.items === items) cache.delete(key);
  });
  return items;
}

export function forgetDpiCatalogs() {
  cache.clear();
}
