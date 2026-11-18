import { type ConnectionTransport, type ConnectionTrustMode, EdgeAuth, RouteKind } from "@prisma/client";
import { homeOrigin } from "@/lib/connection-routes";
import type { SignedInSession } from "./auth";
import { assertEndpoint, hasPendingPairing, isManagedRoute, isUniqueViolation, publicEndpoint, signedEndpointManifest } from "./connection";
import { prisma } from "./db";
import { EdgeAuthError, edgeTokenUpdate } from "./edge-auth";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { forgetRouteReached } from "./tunnel/remote-access";
import { NO_EVIDENCE, checkRoute } from "./tunnel/route-check";
import { currentHouseholdId } from "./household-context";

/**
 * What Settings does with how phones connect: the routes the household runs, the home network
 * address, and the connection page's summary.
 */

const MANAGED = "This route follows FamilyFi's own tunnel. Change it from Remote access instead.";

type Edge = { edgeAuth?: EdgeAuth; serviceToken?: { clientId: string; clientSecret: string } };

function endpointNotFound() {
  return new ApiError(404, "not_found", "Connection endpoint not found.");
}

function checkedUrl(route: Parameters<typeof assertEndpoint>[0]): string {
  try {
    return assertEndpoint(route);
  } catch (error) {
    throw new ApiError(400, "invalid_endpoint", error instanceof Error ? error.message : "Invalid connection endpoint.");
  }
}

function edgeUpdate(...args: Parameters<typeof edgeTokenUpdate>) {
  try {
    return edgeTokenUpdate(...args);
  } catch (error) {
    if (error instanceof EdgeAuthError) throw new ApiError(error.status, error.code, error.message);
    throw error;
  }
}

function endpointExists(error: unknown): never {
  if (isUniqueViolation(error)) throw new ApiError(409, "endpoint_exists", "A route with this address already exists.");
  throw error;
}

/** The connection page: the caller's routes, the gateway's status and the caller's last change. */
export async function connectionOverview(session: SignedInSession) {
  const [household, lastRun, lastChange] = await Promise.all([
    loadHousehold(),
    prisma().syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    // The caller's own last change; a child's phone acts as no account and makes none.
    session.accountId ? prisma().changeResult.findFirst({ where: { actorAccountId: session.accountId }, orderBy: { updatedAt: "desc" } }) : null,
  ]);
  const manifest = await signedEndpointManifest({ deviceId: session.deviceId });
  return {
    endpoints: manifest.endpoints,
    endpointManifest: manifest,
    // A child's phone needs the manifest, not the gateway's error text.
    unifi: { status: household.connectionStatus, error: session.device?.clientType === "me" ? null : household.connectionError, lastSyncAt: lastRun?.finishedAt?.toISOString() ?? lastRun?.startedAt?.toISOString() ?? null },
    lastChange: lastChange ? { id: lastChange.id, scope: lastChange.scope, status: lastChange.status, error: lastChange.error, updatedAt: lastChange.updatedAt.toISOString() } : null,
  };
}

/** Where FamilyFi is on the home network, or null when none is saved. */
export async function getHomeUrl(): Promise<string | null> {
  return (await loadHousehold()).homeUrl;
}

/** Saves the home network address; null or a blank clears it. */
export async function setHomeUrl(raw: string | null): Promise<string | null> {
  const blank = raw === null || raw.trim() === "";
  const url = blank ? null : homeOrigin(raw!);
  if (!blank && !url) throw new ApiError(400, "invalid_home_url", "Use an http or https address with no path, such as http://192.168.1.10:7001.");
  const household = await prisma().household.update({ where: { id: currentHouseholdId() }, data: { homeUrl: url } });
  return household.homeUrl;
}

export async function listEndpoints() {
  const endpoints = await prisma().connectionEndpoint.findMany({ where: { householdId: currentHouseholdId() }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  return endpoints.map(publicEndpoint);
}

export async function createEndpoint(
  input: { url: string; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256?: string; priority?: number; enabled?: boolean } & Edge,
) {
  const { edgeAuth, serviceToken, ...route } = input;
  const url = checkedUrl(route);
  const edge = edgeUpdate(
    { kind: RouteKind.own, transport: route.transport, edgeAuth: EdgeAuth.none, edgeTokenCiphertext: null, edgeTokenIv: null, edgeTokenAuthTag: null, edgeTokenVersion: 0, edgeTokenRotatedAt: null },
    { edgeAuth, serviceToken },
  );
  try {
    // Routes created here are always the household's own; FamilyFi's tunnel routes come from Remote access.
    const endpoint = await prisma().connectionEndpoint.create({ data: { ...route, ...edge.data, url, kind: RouteKind.own } });
    return publicEndpoint(endpoint);
  } catch (error) {
    return endpointExists(error);
  }
}

export async function updateEndpoint(
  id: string,
  input: { url?: string; transport?: ConnectionTransport; trustMode?: "system" | "pinned"; spkiSha256?: string | null; priority?: number; enabled?: boolean } & Edge,
) {
  const current = await prisma().connectionEndpoint.findUnique({ where: { id } });
  if (!current) throw endpointNotFound();
  if (isManagedRoute(current)) throw new ApiError(409, "managed_route", MANAGED);
  const { edgeAuth, serviceToken, ...changes } = input;
  const trustMode = changes.trustMode ?? current.trustMode;
  const transport = changes.transport ?? current.transport;
  const spkiSha256 = changes.spkiSha256 === undefined ? current.spkiSha256 : changes.spkiSha256;
  const url = checkedUrl({ url: changes.url ?? current.url, transport, trustMode, spkiSha256 });
  const edge = edgeUpdate({ ...current, transport }, { edgeAuth, serviceToken });
  try {
    const endpoint = await prisma().$transaction(async (db) => {
      // With Access off, nobody holds a token for this route any more.
      if (edge.cleared) await db.deviceEdgeToken.deleteMany({ where: { endpointId: id } });
      // Whatever showed the old route worked says nothing about the changed one.
      return db.connectionEndpoint.update({ where: { id }, data: { ...changes, ...edge.data, url, transport, trustMode, spkiSha256, ...NO_EVIDENCE } });
    });
    forgetRouteReached();
    return publicEndpoint(endpoint);
  } catch (error) {
    return endpointExists(error);
  }
}

export async function deleteEndpoint(id: string) {
  const current = await prisma().connectionEndpoint.findUnique({ where: { id } });
  if (!current) throw endpointNotFound();
  if (isManagedRoute(current)) throw new ApiError(409, "managed_route", MANAGED);
  if (await hasPendingPairing(id)) {
    throw new ApiError(409, "endpoint_in_use", "A pairing code for this route is still active. Cancel it or wait for it to expire.");
  }
  // Deleting the published route leaves nothing published: remote access is Off.
  const deleted = await prisma().$transaction(async (db) => {
    await db.household.updateMany({ where: { id: currentHouseholdId(), remoteEndpointId: id }, data: { remoteEndpointId: null } });
    return db.connectionEndpoint.deleteMany({ where: { id } });
  });
  if (!deleted.count) throw endpointNotFound();
}

/** Asks a route the household runs for this household's identity, from home, and keeps what it found. */
export async function checkEndpoint(id: string) {
  const route = await prisma().connectionEndpoint.findUnique({ where: { id } });
  if (!route) throw endpointNotFound();
  if (isManagedRoute(route)) throw new ApiError(409, "managed_route", "This route follows FamilyFi's own tunnel, which reports its own status.");
  const reachability = await checkRoute(id);
  if (!reachability) throw endpointNotFound();
  return reachability;
}
