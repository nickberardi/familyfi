/**
 * Parent-facing copy and small pure helpers for the Pair Device page: how a route is
 * named, which Remote access choice the published route stands for, and what a pairing
 * code looks like.
 */
import { relativeSweep } from "./sync-copy";
import type { ConnectionRoute, ConnectionTransport, PairedPhone, RemoteAccess } from "./types";

export const TRANSPORTS: readonly { value: ConnectionTransport; label: string }[] = [
  { value: "lan", label: "My domain" },
  { value: "tailscale", label: "Tailscale" },
  { value: "cloudflare", label: "Cloudflare Tunnel" },
];

export function transportLabel(transport: string): string {
  return TRANSPORTS.find((item) => item.value === transport)?.label ?? transport;
}

/** Only a My domain route may pin a certificate; everything else uses ordinary trust. */
export function canPin(transport: ConnectionTransport): boolean {
  return transport === "lan";
}

/**
 * The home network address as an origin, or null when it is not one: http or https, with no
 * credentials, path, query or fragment. Unlike a route it may be plain http, as FamilyFi often is at home.
 */
export function homeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const bare = url.username === "" && url.password === "" && (url.pathname === "" || url.pathname === "/") && url.search === "" && url.hash === "";
  return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "" && bare ? url.origin : null;
}

/** `GET /api/v1/connection/home`: the saved home network address, and the address this request came in at. */
export type HomeAccess = { url: string | null; current: { url: string; private: boolean } };

/** The address agents pair at: the saved one, or the current one when it is private; null asks for one. */
export function homeAddress(home: HomeAccess): string | null {
  return home.url ?? (home.current.private ? home.current.url : null);
}

/**
 * Whether an origin can only be reached inside a home: a private, loopback, link-local or
 * carrier-grade NAT address, `localhost`, or a `.local` or `.home.arpa` name. Home access
 * suggests the address the web app was opened at only when it is one of these; a public name
 * may sit behind a proxy's sign-in page, which an agent cannot get past.
 */
export function isPrivateOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "home.arpa" || host.endsWith(".home.arpa")) return true;
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    return v6 === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
  }
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return false;
  const [a = 0, b = 0] = octets.map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const WIKI = "https://github.com/nickberardi/familyfi/wiki";
/** My domain: publishing FamilyFi yourself, through a reverse proxy or a tunnel you run. */
export const MY_DOMAIN_GUIDE = `${WIKI}/Remote-access-home-network`;
/** Running Tailscale Serve as a sidecar container. */
export const TAILSCALE_GUIDE = `${WIKI}/Remote-access-Tailscale`;
/** FamilyFi's own Cloudflare Tunnel on your domain: the permanent address a Quick tunnel lacks. */
export const CLOUDFLARE_AUTOMATIC_GUIDE = `${WIKI}/Remote-access-Cloudflare-Automatic`;
/** Running your own Cloudflare Tunnel, optionally behind Cloudflare Access. */
export const CLOUDFLARE_GUIDE = `${WIKI}/Remote-access-Cloudflare-Tunnel`;

/** How long a device counts as in use: Cloudflare's longest grace period for a rotated secret. */
export const ACTIVE_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How far a route's current Cloudflare Access token has reached the household's devices.
 * Devices pick it up the next time they reach FamilyFi; until all active ones have it,
 * Cloudflare must keep accepting what they hold — no Access application yet for a first token,
 * the old token for a replacement — or it turns them away. Revoked devices, and ones not seen within
 * Cloudflare's longest grace period, are not waited for.
 */
export function accessRollout(
  route: Pick<ConnectionRoute, "id" | "edgeTokenVersion">,
  devices: readonly Pick<PairedPhone, "displayName" | "revokedAt" | "lastSeenAt" | "edgeTokens">[],
  now = Date.now(),
): { done: boolean; text: string } {
  const version = route.edgeTokenVersion ?? 0;
  const active = devices.filter((device) => !device.revokedAt && device.lastSeenAt && now - new Date(device.lastSeenAt).getTime() <= ACTIVE_DEVICE_WINDOW_MS);
  const behind = active.filter((device) => !device.edgeTokens.some((token) => token.endpointId === route.id && token.version >= version));
  const replaced = version > 1;
  const token = replaced ? "the new token" : "the token";
  if (!active.length) return { done: true, text: "No active phones yet." };
  if (!behind.length) {
    return { done: true, text: `Every active phone has ${token}.${replaced ? " You can remove the old one in Cloudflare." : ""}` };
  }
  const names = behind.map((device) => device.displayName).join(", ");
  const hold = replaced ? "Keep the old token in Cloudflare until then." : "Create the Access application in Cloudflare after that; if it already exists, Cloudflare turns them away until then.";
  return { done: false, text: `${active.length - behind.length} of ${active.length} active phones have ${token}. Waiting for ${names}. ${hold}` };
}

/**
 * Everything Remote access can publish. `myDomain`, `tailscale` and `cloudflareAdvanced` are
 * routes the household runs; `quick` and `cloudflareAutomatic` are FamilyFi's own tunnel.
 * `myDomain` is the do-it-yourself one: any HTTPS address the household publishes itself.
 */
export type RemoteChoice = "off" | "quick" | "myDomain" | "tailscale" | "cloudflareAutomatic" | "cloudflareAdvanced";

/** The transport a household-run choice saves its route with. */
export const OWN_TRANSPORT: Partial<Record<RemoteChoice, ConnectionTransport>> = { myDomain: "lan", tailscale: "tailscale", cloudflareAdvanced: "cloudflare" };

/** Which choice the published route stands for. */
export function remoteChoice(tunnel: Pick<RemoteAccess, "mode" | "endpointId">, routes: readonly ConnectionRoute[]): RemoteChoice {
  const route = routes.find((item) => item.id === tunnel.endpointId);
  if (!route) {
    // Nothing is published yet while a first quick tunnel comes up or a domain is being set up.
    if (tunnel.mode === "quick") return "quick";
    return tunnel.mode === "named" ? "cloudflareAutomatic" : "off";
  }
  return routeChoice(route);
}

/** The choice that publishes a saved route. */
export function routeChoice(route: Pick<ConnectionRoute, "kind" | "transport">): Exclude<RemoteChoice, "off"> {
  if (route.kind === "quick") return "quick";
  if (route.kind === "domain") return "cloudflareAutomatic";
  if (route.transport === "tailscale") return "tailscale";
  return route.transport === "cloudflare" ? "cloudflareAdvanced" : "myDomain";
}

/** Each choice as Remote access names it, Cloudflare's two setups included. */
export const CHOICE_LABEL: Record<Exclude<RemoteChoice, "off">, string> = {
  quick: "Quick tunnel",
  myDomain: "My domain",
  tailscale: "Tailscale",
  cloudflareAutomatic: "Cloudflare Automatic",
  cloudflareAdvanced: "Cloudflare Advanced",
};

/**
 * What saving an address under a choice that runs `transport` may do with a route already saved
 * at that address: reuse one of the same transport, or refuse one any other choice publishes,
 * since taking it over would move it out of that choice and change its transport for paired phones.
 */
export function routeForAddress(
  routes: readonly ConnectionRoute[],
  url: string,
  transport: ConnectionTransport,
): { reuse: ConnectionRoute } | { conflict: ConnectionRoute } | null {
  let origin: string;
  try {
    origin = new URL(url.trim()).origin;
  } catch {
    return null;
  }
  const existing = routes.find((route) => route.url === origin);
  if (!existing) return null;
  return existing.kind === "own" && existing.transport === transport ? { reuse: existing } : { conflict: existing };
}

/** Why an address can't be saved under another choice than the one its route already belongs to. */
export function addressConflict(route: Pick<ConnectionRoute, "kind" | "transport">): string {
  const label = CHOICE_LABEL[routeChoice(route)];
  return `This address is already saved as your ${label} route. Choose ${label} to use it, or enter a different address.`;
}

/** The saved route a choice would publish again, if it has one. */
export function savedRoute(choice: RemoteChoice, routes: readonly ConnectionRoute[]): ConnectionRoute | undefined {
  if (choice === "cloudflareAutomatic") return routes.find((route) => route.kind === "domain");
  return savedRoutes(choice, routes)[0];
}

/** Every route the household saved for a choice it runs itself, in the order phones try them. */
export function savedRoutes(choice: RemoteChoice, routes: readonly ConnectionRoute[]): ConnectionRoute[] {
  const transport = OWN_TRANSPORT[choice];
  return transport ? sortRoutes(routes.filter((route) => route.kind === "own" && route.transport === transport)) : [];
}

/** What removing a saved route asks first: the published one turns remote access off. */
export function removeRouteConfirm(route: Pick<ConnectionRoute, "url">, { published, pairedCount }: { published: boolean; pairedCount: number }) {
  const count = `${pairedCount} phone${pairedCount === 1 ? "" : "s"}`;
  const message = published
    ? `Phones reach home through it now, so remote access turns off.${pairedCount ? ` ${count} paired through it can't reach home from outside until you publish another route.` : ""}`
    : `Phones aren't using it now.${pairedCount ? ` ${count} first paired through it.` : ""}`;
  return { title: `Remove ${route.url}?`, message, confirmLabel: "Remove" };
}

/** Routes in the order phones try them — the same tie-break the server's manifest uses. */
export function sortRoutes<T extends Pick<ConnectionRoute, "priority">>(routes: readonly T[]): T[] {
  return routes.map((route, index) => ({ route, index })).sort((a, b) => a.route.priority - b.route.priority || a.index - b.index).map((item) => item.route);
}

export function countdown(msRemaining: number): string {
  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A pin is long; show enough of each end to compare by eye. */
export function shortPin(pin: string): string {
  return pin.length > 12 ? `${pin.slice(0, 6)}…${pin.slice(-6)}` : pin;
}

/** How a paired phone trusts a route: its pinned certificate or the system's check, and Access in front. */
export function routeTrust(route: Pick<ConnectionRoute, "trustMode" | "spkiSha256" | "edgeAuth">): string {
  const trust =
    route.trustMode === "pinned" && route.spkiSha256 ? `Pinned certificate ${shortPin(route.spkiSha256)}` : "Certificate checked by the system";
  return route.edgeAuth === "serviceToken" ? `${trust} · behind Cloudflare Access` : trust;
}

/** What remote access is doing, as Pair Device names it. */
export const REMOTE_STATUS: Record<RemoteAccess["status"], { label: string; ink: string }> = {
  off: { label: "Off", ink: "var(--ff-muted)" },
  "signing-in": { label: "Waiting for Cloudflare…", ink: "var(--ff-muted)" },
  starting: { label: "Starting…", ink: "var(--ff-muted)" },
  running: { label: "On", ink: "var(--ff-on-ink)" },
  error: { label: "Not connected", ink: "var(--ff-danger)" },
  unavailable: { label: "Unavailable", ink: "var(--ff-danger)" },
};

/**
 * How Pair Device names a published route the household runs, from the evidence it has: never
 * "On" on its say-so alone. A request through the route is the best evidence there is, and
 * FamilyFi's own check from home is next. A failed check is only "Not reached" while nothing has
 * come in since; a check from inside the home can fail while the route works from outside.
 */
export function ownRouteStatus(reachability: RemoteAccess["reachability"], now = new Date()): { label: string; ink: string; detail: string | null } {
  const { reachedAt = null, checkedAt = null, result = null, message = null } = reachability ?? {};
  const failed = result === "failed" && checkedAt !== null;
  const reached = [reachedAt, result === "reached" ? checkedAt : null].filter((at): at is string => at !== null).sort().at(-1) ?? null;
  const ago = (at: string) => {
    const age = relativeSweep(at, now);
    return age === "now" ? "just now" : `${age} ago`;
  };
  if (failed && (!reachedAt || reachedAt < checkedAt)) {
    const why = message ? ` ${message}` : "";
    return reachedAt
      ? { label: `Reached ${ago(reachedAt)}`, ink: "var(--ff-on-ink)", detail: `Couldn't check from FamilyFi.${why}` }
      : { label: "Not reached", ink: "var(--ff-danger)", detail: `No phone has come in through this address, and FamilyFi couldn't reach it.${why}` };
  }
  if (reached) return { label: `Reached ${ago(reached)}`, ink: "var(--ff-on-ink)", detail: null };
  return { label: "Published", ink: "var(--ff-muted)", detail: "Nothing has come in through this address yet." };
}

/** What Pair Device says remote access is doing: the tunnel's status, or the evidence for a route the household runs. */
export function remoteStatus(tunnel: Pick<RemoteAccess, "status" | "reachability"> | null, now = new Date()): { label: string; ink: string; detail: string | null } {
  if (tunnel?.reachability) return ownRouteStatus(tunnel.reachability, now);
  return { ...REMOTE_STATUS[tunnel?.status ?? "off"], detail: null };
}
