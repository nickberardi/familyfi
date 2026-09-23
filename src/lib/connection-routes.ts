/**
 * Parent-facing copy and small pure helpers for the Phones page: how a route is named,
 * what a pairing code looks like, and how reordering maps onto priorities.
 */
import type { ConnectionRoute, ConnectionTransport } from "./types";

export const TRANSPORTS: readonly { value: ConnectionTransport; label: string; note: string }[] = [
  { value: "lan", label: "Home network", note: "The phone reaches FamilyFi directly on your Wi-Fi." },
  { value: "vpn", label: "VPN", note: "Your own VPN into the home network (Teleport, WireGuard). FamilyFi does not create it." },
  { value: "reverseProxy", label: "Reverse proxy", note: "An HTTPS proxy you run in front of FamilyFi, with a publicly trusted certificate." },
  { value: "tailscale", label: "Tailscale Serve", note: "A https://…ts.net address from Tailscale Serve. The phone must be in your tailnet. Never use Funnel." },
  {
    value: "cloudflare",
    label: "Cloudflare Tunnel",
    note: "Cloudflare Access must be satisfied by the Cloudflare One Client on the phone. FamilyFi never stores tunnel credentials.",
  },
];

export function transportLabel(transport: string): string {
  return TRANSPORTS.find((item) => item.value === transport)?.label ?? transport;
}

/** Only a direct LAN route may pin a certificate; everything else uses ordinary trust. */
export function canPin(transport: ConnectionTransport): boolean {
  return transport === "lan";
}

/** Routes in the order phones try them — the same tie-break the server's manifest uses. */
export function sortRoutes<T extends Pick<ConnectionRoute, "priority">>(routes: readonly T[]): T[] {
  return routes.map((route, index) => ({ route, index })).sort((a, b) => a.route.priority - b.route.priority || a.index - b.index).map((item) => item.route);
}

/**
 * Moves one route up or down and returns the priority changes to send. Priorities are
 * renumbered 0, 10, 20… so no two routes tie: the server breaks ties by creation time
 * and the phone by id, and a tie is the one case where the two could disagree.
 */
export function reorderRoutes(routes: readonly ConnectionRoute[], id: string, direction: -1 | 1): { id: string; priority: number }[] {
  const ordered = sortRoutes(routes);
  const from = ordered.findIndex((route) => route.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return [];
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  return ordered.map((route, index) => ({ id: route.id, priority: index * 10 })).filter((change) => routes.find((route) => route.id === change.id)?.priority !== change.priority);
}

/** The next priority for a new route: after every existing one. */
export function nextPriority(routes: readonly Pick<ConnectionRoute, "priority">[]): number {
  return routes.length ? Math.min(999, Math.max(...routes.map((route) => route.priority)) + 10) : 0;
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
