import type { DpiCatalogItem } from "./types";
import { prisma } from "../db";
import { ApiError } from "../http";
import type { UnifiClient } from "./client";
import { clientForHousehold, connectionIdentity } from "./connection";
import { UnifiConfigError } from "./errors";

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

/**
 * The gateway's DPI applications or categories for a rule's picker. A filtered search asks the
 * gateway; the whole catalog is shared between requests.
 */
export async function listDpi(kind: "applications" | "categories", filter: string | undefined): Promise<DpiCatalogItem[]> {
  const household = await prisma().household.findUnique({ where: { id: "default" } });
  if (!household || household.connectionStatus === "unconfigured") {
    throw new ApiError(409, "unifi_unconfigured", `Configure UniFi in Settings before listing DPI ${kind}.`);
  }
  try {
    const client = clientForHousehold(household);
    if (!filter) return await dpiCatalog(connectionIdentity(household), kind, client);
    return await (kind === "applications" ? client.listDpiApplications(filter) : client.listDpiCategories(filter));
  } catch (error) {
    if (error instanceof UnifiConfigError) throw new ApiError(409, "unifi_unconfigured", error.message);
    throw error;
  }
}
