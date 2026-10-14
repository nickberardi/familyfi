import type { PublicUnifiNetwork } from "./scope";

/**
 * The site's networks as the last reconcile pass read them, so Settings, which every open
 * page polls, does not ask the console for each network again. Older than this, or for
 * another console or site, the caller reads the console itself.
 */
export const NETWORK_CACHE_MS = 2 * 60_000;

type Entry = { identity: string; networks: PublicUnifiNetwork[]; at: number };
type Cache = { entry: Entry | null };

// Next.js bundles instrumentation (reconcile) and route handlers separately; both share this.
const cache: Cache = ((globalThis as { familyfiNetworkCache?: Cache }).familyfiNetworkCache ??= { entry: null });

export function rememberSiteNetworks(identity: string, networks: PublicUnifiNetwork[], now = Date.now()) {
  cache.entry = { identity, networks, at: now };
}

export function recentSiteNetworks(identity: string, now = Date.now()): PublicUnifiNetwork[] | null {
  const entry = cache.entry;
  if (!entry || entry.identity !== identity || now - entry.at > NETWORK_CACHE_MS) return null;
  return entry.networks;
}

export function forgetSiteNetworks() {
  cache.entry = null;
}
