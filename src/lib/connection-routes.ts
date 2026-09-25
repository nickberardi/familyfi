/**
 * Parent-facing copy and small pure helpers for the Pair Device page: how a route is
 * named, which Remote access choice the published route stands for, and what a pairing
 * code looks like.
 */
import type { ConnectionRoute, ConnectionTransport, RemoteAccess } from "./types";

export const TRANSPORTS: readonly { value: ConnectionTransport; label: string }[] = [
  { value: "lan", label: "Home network" },
  { value: "tailscale", label: "Tailscale" },
  { value: "cloudflare", label: "Cloudflare Tunnel" },
];

export function transportLabel(transport: string): string {
  return TRANSPORTS.find((item) => item.value === transport)?.label ?? transport;
}

/** Only a home-network route may pin a certificate; everything else uses ordinary trust. */
export function canPin(transport: ConnectionTransport): boolean {
  return transport === "lan";
}

const WIKI = "https://github.com/nickberardi/familyfi/wiki";
/** Setting up a VPN or a reverse proxy in front of FamilyFi. */
export const HOME_NETWORK_GUIDE = `${WIKI}/Remote-access-home-network`;
/** Running Tailscale Serve as a sidecar container. */
export const TAILSCALE_GUIDE = `${WIKI}/Remote-access-Tailscale`;

/**
 * Everything Remote access can publish. `home`, `tailscale` and `cloudflareAdvanced` are
 * routes the household runs; `quick` and `cloudflareAutomatic` are FamilyFi's own tunnel.
 */
export type RemoteChoice = "off" | "quick" | "home" | "tailscale" | "cloudflareAutomatic" | "cloudflareAdvanced";

/** The transport a household-run choice saves its route with. */
export const OWN_TRANSPORT: Partial<Record<RemoteChoice, ConnectionTransport>> = { home: "lan", tailscale: "tailscale", cloudflareAdvanced: "cloudflare" };

/** Which choice the published route stands for. */
export function remoteChoice(tunnel: Pick<RemoteAccess, "mode" | "endpointId">, routes: readonly ConnectionRoute[]): RemoteChoice {
  const route = routes.find((item) => item.id === tunnel.endpointId);
  if (!route) {
    // Nothing is published yet while a first quick tunnel comes up or a domain is being set up.
    if (tunnel.mode === "quick") return "quick";
    return tunnel.mode === "named" ? "cloudflareAutomatic" : "off";
  }
  if (route.kind === "quick") return "quick";
  if (route.kind === "domain") return "cloudflareAutomatic";
  if (route.transport === "tailscale") return "tailscale";
  return route.transport === "cloudflare" ? "cloudflareAdvanced" : "home";
}

/** The saved route a choice would publish again, if it has one. */
export function savedRoute(choice: RemoteChoice, routes: readonly ConnectionRoute[]): ConnectionRoute | undefined {
  if (choice === "cloudflareAutomatic") return routes.find((route) => route.kind === "domain");
  const transport = OWN_TRANSPORT[choice];
  return transport ? sortRoutes(routes.filter((route) => route.kind === "own" && route.transport === transport))[0] : undefined;
}

/** Routes in the order phones try them — the same tie-break the server's manifest uses. */
export function sortRoutes<T extends Pick<ConnectionRoute, "priority">>(routes: readonly T[]): T[] {
  return routes.map((route, index) => ({ route, index })).sort((a, b) => a.route.priority - b.route.priority || a.index - b.index).map((item) => item.route);
}

/** The manual fallback the app accepts: `pairingId.token`. It cannot carry a certificate pin. */
export function manualPairingCode(qr: { pairingId: string; token: string }): string {
  return `${qr.pairingId}.${qr.token}`;
}

export function countdown(msRemaining: number): string {
  const seconds = Math.max(0, Math.ceil(msRemaining / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A pin is long; show enough of each end to compare by eye. */
export function shortPin(pin: string): string {
  return pin.length > 12 ? `${pin.slice(0, 6)}…${pin.slice(-6)}` : pin;
}
