import { ApiError, TransportError, type ApiRequest } from "./api-client";
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
 * answered, as familyfi-ios's client does, then the rest in manifest order. A read (or a sign-in or
 * sign-out, which change nothing in the household) that finds a route unreachable, or behind a Cloudflare
 * Access wall, moves to the next route; a household write never does, since it may have landed.
 */

const TIMEOUT_MS = 15_000;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
/** Writes that change nothing in the household, so any route may take them. */
const FAILOVER_WRITES = new Set(["/api/v1/auth/login", "/api/v1/auth/logout"]);

export type CompanionConnection = {
  /** The trusted routes, from the last verified manifest (or a pairing code's stand-in). */
  routes: () => ConnectionRoute[];
  edgeCredentials: () => EndpointCredential[];
  /** The bearer token, once signed in. */
  token?: () => string | null;
  /** The route that last answered, where each request starts. */
  activeRouteId?: () => string | null;
  /** Told which route answered, so the Connection screen can show it and the next request starts there. */
  onRoute?: (route: ConnectionRoute) => void;
};

export function createCompanionRequest(transport: Transport, connection: CompanionConnection): ApiRequest {
  return async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    // Only the household API: never another host, never another path.
    if (!path.startsWith("/api/v1/")) throw new Error(`Not an /api/v1 path: ${path}`);
    const method = (init.method ?? "GET").toUpperCase();
    const retryable = SAFE_METHODS.has(method) || FAILOVER_WRITES.has(path);
    const token = connection.token?.() ?? null;
    let lastFailure: unknown = new Error("FamilyFi has no route to try.");

    const candidates = candidateRoutes(connection.routes());
    const active = connection.activeRouteId?.() ?? null;
    const ordered = [
      ...candidates.filter((route) => route.id === active),
      ...candidates.filter((route) => route.id !== active),
    ];
    for (const route of ordered) {
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
          timeoutMs: TIMEOUT_MS,
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
      connection.onRoute?.(route);
      if (response.status < 200 || response.status >= 300) {
        const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
        throw new ApiError(error?.message ?? "Request failed.", response.status, error?.code);
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
