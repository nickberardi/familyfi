import { apiErrorOf, TransportError, type ApiRequest } from "./api-client";
import { candidateRoutes, edgeHeaders, isEdgeUnavailable, type EndpointCredential } from "./companion-trust";
import type { ConnectionRoute } from "./types";

/**
 * One HTTPS exchange with a household route, as a companion's transport performs it (the Expo
 * app's native `familyfi-transport` module): a pinned route trusts only a leaf certificate whose SPKI
 * SHA-256 equals the pin; a system route uses the platform's trust. Redirects are returned, never followed, so a Cloudflare
 * Access sign-in redirect reads as the route being unavailable. It rejects with a TransportError
 * when there was no response: unreachable, timed out, or a certificate that did not match.
 */
export type TransportRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  trustMode: "system" | "pinned";
  /** The route's pin, for a pinned route. A pinned route with none fails closed. */
  pin: string | null;
  timeoutMs: number;
  /**
   * How long to wait for the connection itself (TCP and TLS), when shorter than `timeoutMs`. Set only
   * for a request that can move to another route, so giving up early never leaves a write's fate unknown.
   */
  connectTimeoutMs?: number;
};

export type TransportResponse = { status: number; headers: Record<string, string>; body: string };

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** Wraps a native transport so every failure without a response is a TransportError. */
export function asTransport(send: (request: TransportRequest) => Promise<TransportResponse>): Transport {
  return async (request) => {
    if (request.trustMode === "pinned" && !request.pin)
      throw new TransportError(new Error("A pinned route has no pin."));
    try {
      return await send(request);
    } catch (error) {
      throw error instanceof TransportError ? error : new TransportError(error);
    }
  };
}

/**
 * A companion's `/api/v1` requests over its trusted routes: the route order and Access rules of
 * `companion-trust.ts` over the phone's transport. Each request starts at the route that last
 * answered, then the rest in manifest order. A read (or a sign-in,
 * sign-out or session refresh, which change nothing in the household) that finds a route unreachable,
 * or behind a Cloudflare Access wall, moves to the next route; a household write never does, since it
 * may have landed, except on a connection made for a device revoking itself (`failover`). A refresh that landed unanswered may be sent again: the server honours the token it
 * just replaced until the device uses the pair that replaced it. Older servers honoured it only
 * once, within `REFRESH_REUSE_GRACE_MS`, so a refresh still gives up on a route well within that
 * grace, leaving the next route time to use it.
 */

const TIMEOUT_MS = 15_000;
const REFRESH_PATH = "/api/v1/auth/refresh";
/**
 * Two routes' attempts fit within the server's grace for the token a refresh just replaced
 * (`REFRESH_REUSE_GRACE_MS`, 10 s, in the server's constants, which a companion does not import;
 * the companion request tests hold the two together).
 */
const REFRESH_TIMEOUT_MS = 5_000;
/**
 * A home-network route gets this long to connect when another route could answer instead. Away from
 * home its address reaches nothing, and a phone otherwise waits out the whole `TIMEOUT_MS` there
 * before moving on; at home the connection is made well within it.
 */
export const LAN_CONNECT_TIMEOUT_MS = 3_000;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
/** Writes that change nothing in the household, so any route may take them. */
const FAILOVER_WRITES = new Set(["/api/v1/auth/login", "/api/v1/auth/logout", REFRESH_PATH]);

/**
 * The network a device is on, as its platform reports it: `wifi` (or wired), `cellular`, or `other`
 * when it can't tell. `key` names the network more closely where the platform can (a Wi-Fi subnet),
 * so a route remembered at home is not the one tried first at a café.
 */
export type DeviceNetwork = { kind: "wifi" | "cellular" | "other"; key?: string };

/** Where a remembered route is kept for a network: its own key, else its kind. */
export function networkKey(network: DeviceNetwork): string {
  return network.key ? `${network.kind}:${network.key}` : network.kind;
}

/**
 * The order a request tries routes in: the enabled routes in manifest order, but on cellular a
 * home-network (`lan`) route last, since it answers there only over a VPN; then the route that last
 * answered on this network first, whatever its kind, so a phone that reached home over a VPN keeps
 * doing so.
 */
export function orderRoutes(routes: ConnectionRoute[], activeId: string | null, network: DeviceNetwork | null): ConnectionRoute[] {
  const candidates = candidateRoutes(routes);
  const byNetwork =
    network?.kind === "cellular"
      ? [...candidates.filter((route) => route.transport !== "lan"), ...candidates.filter((route) => route.transport === "lan")]
      : candidates;
  return [...byNetwork.filter((route) => route.id === activeId), ...byNetwork.filter((route) => route.id !== activeId)];
}

export type CompanionConnection = {
  /** The trusted routes, from the last verified manifest (or a pairing code's stand-in). */
  routes: () => ConnectionRoute[];
  edgeCredentials: () => EndpointCredential[];
  /** The bearer token, once signed in. */
  token?: () => string | null;
  /** The route that last answered, where each request starts. */
  activeRouteId?: () => string | null;
  /**
   * Told which route answered, and the network the request was ordered for, so the Connection screen
   * can show it and the next request on that network starts there.
   */
  onRoute?: (route: ConnectionRoute, network: DeviceNetwork | null) => void;
  /** The network the device is on now, which orders the routes (`orderRoutes`); unknown when absent. */
  network?: () => DeviceNetwork | null;
  /**
   * Every request may move to the next route, writes too. Only for a write that ends the same however
   * often it lands: a device revoking itself, whose second arrival finds it already revoked.
   */
  failover?: boolean;
};

export function createCompanionRequest(transport: Transport, connection: CompanionConnection): ApiRequest {
  return async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    // Only the household API: never another host, never another path.
    if (!path.startsWith("/api/v1/")) throw new Error(`Not an /api/v1 path: ${path}`);
    const method = (init.method ?? "GET").toUpperCase();
    const retryable = connection.failover === true || SAFE_METHODS.has(method) || FAILOVER_WRITES.has(path);
    const token = connection.token?.() ?? null;
    let lastFailure: unknown = new Error("FamilyFi has no route to try.");

    // Read once: a request that outlasts a change of network still reports the network it was ordered for.
    const network = connection.network?.() ?? null;
    const ordered = orderRoutes(connection.routes(), connection.activeRouteId?.() ?? null, network);
    for (const [index, route] of ordered.entries()) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...edgeHeaders(route, connection.edgeCredentials()),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      let response;
      try {
        response = await transport({
          url: `${route.url}${path}`,
          method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          trustMode: route.trustMode,
          pin: route.trustMode === "pinned" ? route.spkiSha256 : null,
          timeoutMs: path === REFRESH_PATH ? REFRESH_TIMEOUT_MS : TIMEOUT_MS,
          // Only where a next route could answer: a lone home route keeps the whole timeout.
          ...(retryable && route.transport === "lan" && index < ordered.length - 1 ? { connectTimeoutMs: LAN_CONNECT_TIMEOUT_MS } : {}),
        });
      } catch (error) {
        lastFailure = error;
        if (retryable) continue;
        throw error instanceof TransportError ? error : new TransportError(error);
      }

      let body: unknown = null;
      try {
        body = response.body ? JSON.parse(response.body) : null;
      } catch {
        body = response.body;
      }
      if (isEdgeUnavailable({ status: response.status, location: header(response.headers, "location"), body })) {
        lastFailure = new Error("Cloudflare Access turned this route away.");
        if (retryable) continue;
        throw new TransportError(lastFailure);
      }
      connection.onRoute?.(route, network);
      if (response.status < 200 || response.status >= 300) {
        throw apiErrorOf(body, response.status);
      }
      return body as T;
    }
    throw lastFailure instanceof TransportError ? lastFailure : new TransportError(lastFailure);
  };
}

function header(headers: Record<string, string>, name: string): string | null {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key]! : null;
}
