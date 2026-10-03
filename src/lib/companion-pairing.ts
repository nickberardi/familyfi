/**
 * Pairing a phone with a household, one explicit step at a time, each with familyfi's shared checks
 * (`pairing-code.ts`, `companion-trust.ts`), over any companion's transport:
 *
 * 1. Read the code, scanned or pasted. Nothing touches the network for a code that fails.
 * 2. Ask the route in the code who it is, and check the identity against the code's fingerprint.
 * 3. Only when the person confirms ("Trust this household"), spend the code. Pairing is the sign-in:
 *    the claim signs the phone in as the adult the invite names, and returns its session and a
 *    manifest, which must be signed by the key just checked, name the same household, and include
 *    the route the phone paired over. There is no password and no device credential.
 */
import { ApiError, TransportError, type ApiRequest } from "./api-client";
import { COMPANION_OFFLINE_GUARD } from "./household-store";
import {
  mergeEdgeCredentials,
  requireEndpoint,
  verifyIdentity,
  verifyManifest,
  type ConnectionIdentity,
  type EndpointCredential,
  type EndpointManifest,
  TrustError,
} from "./companion-trust";
import { createCompanionRequest, type Transport } from "./companion-request";
import { PairingCodeError, parsePairingCode, type PairingCode } from "./pairing-code";
import type { ConnectionRoute, Session } from "./types";

/** What a paired phone keeps about its household, once its identity and signed manifest checked out. */
export type ConnectionProfile = {
  instanceId: string;
  householdName: string;
  keyFingerprint: string;
  /** The household's Ed25519 public key (JWK `x`), which every later manifest must be signed by. */
  publicKeyX: string;
  /** This phone's paired device, which "Unpair this phone" revokes. */
  deviceId: string;
  endpoints: ConnectionRoute[];
};

/** A signed-in phone's session: its one-hour bearer and the rotating refresh token that renews it. */
export type StoredSession = { token: string; session: Session; refreshToken: string | null };

export const PAIRING_UNREACHABLE = "Can't reach FamilyFi at the address in this code. Check this phone is on the home network, then try again.";

/** What to show when a pairing step fails: the check's own message, the server's, or that it could not be reached. */
export function pairingErrorMessage(error: unknown): string {
  if (error instanceof PairingCodeError || error instanceof TrustError || error instanceof ApiError) return error.message;
  if (error instanceof TransportError) return PAIRING_UNREACHABLE;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Android 17 puts connections to the local network behind a runtime permission (Nearby devices).
 * A household reached only over the internet works without it; one with a home-network route may not.
 */
export const LOCAL_NETWORK_DENIED =
  "FamilyFi couldn't reach your household. To reach it on your home network, allow Nearby devices for FamilyFi in Settings, then try again.";
export const LOCAL_NETWORK_OFF =
  "Can't reach FamilyFi — Nearby devices is off for FamilyFi, and it needs that on your home network. Allow it in Settings.";
export const ROUTES_UNREACHABLE = "Couldn't reach FamilyFi on any route. These are the routes it last signed.";

/** Whether reaching this household may need local network access: it has an enabled home-network route. */
export function needsLocalNetwork(routes: readonly Pick<ConnectionRoute, "enabled" | "transport">[]): boolean {
  return routes.some((route) => route.enabled && route.transport === "lan");
}

/** What a failed pairing step says, and whether Settings can fix it (local network access was refused). */
export function pairingFailure(error: unknown, localNetwork: boolean): { message: string; settings: boolean } {
  if (!localNetwork && error instanceof TransportError) return { message: LOCAL_NETWORK_DENIED, settings: true };
  return { message: pairingErrorMessage(error), settings: false };
}

/** A failed check of the signed routes (the phone's Connection screen). */
export function routeCheckError(error: unknown): string {
  if (error instanceof TransportError) return ROUTES_UNREACHABLE;
  return error instanceof Error ? error.message : String(error);
}

/** The stale message to show: the permission's, while it is off and may be why the household is unreachable. */
export function companionStaleMessage(message: string, localNetwork: boolean): string {
  return message === COMPANION_OFFLINE_GUARD.stale && !localNetwork ? LOCAL_NETWORK_OFF : message;
}

/** A household that verified but is not yet trusted: it holds the unspent code, so it lives only in memory. */
export type PendingEnrollment = { code: PairingCode; identity: ConnectionIdentity };

/** Requests over the code's own route, before any manifest exists. */
function codeRequest(transport: Transport, code: PairingCode): ApiRequest {
  const credentials: EndpointCredential[] = code.edgeCredential
    ? [{ ...code.edgeCredential, endpointId: code.endpoint.id }]
    : [];
  return createCompanionRequest(transport, { routes: () => [code.endpoint], edgeCredentials: () => credentials });
}

/** Steps 1 and 2: read the code and verify who answers at its route. Throws a PairingCodeError, TrustError or transport error. */
export async function verifyHousehold(transport: Transport, text: string): Promise<PendingEnrollment> {
  const code = parsePairingCode(text);
  const identity = await codeRequest(transport, code)<ConnectionIdentity>("/api/v1/connection/identity");
  verifyIdentity(identity, code.keyFingerprint);
  return { code, identity };
}

/** What a claim answers (`POST /api/v1/paired/invites/{id}/claim`), every client the same way. */
export type ClaimResponse = {
  device: { id: string; displayName: string };
  session: Session;
  token: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connection: { manifest: EndpointManifest };
};

/**
 * Step 3: spend the code, which signs the phone in. Called only from the explicit trust action.
 * The code's `pairingId` is the invite's id.
 */
export async function claimHousehold(
  transport: Transport,
  pending: PendingEnrollment,
  deviceName: string,
): Promise<{ profile: ConnectionProfile; edgeCredentials: EndpointCredential[]; session: StoredSession }> {
  const { code, identity } = pending;
  const claim = await codeRequest(transport, code)<ClaimResponse>(
    `/api/v1/paired/invites/${encodeURIComponent(code.pairingId)}/claim`,
    {
      method: "POST",
      body: { token: code.token, deviceName },
    },
  );
  const manifest = verifyManifest(claim.connection.manifest, identity.publicKey.x, identity.instanceId);
  requireEndpoint(manifest, code.endpoint.url);
  return {
    profile: {
      instanceId: identity.instanceId,
      householdName: identity.householdName,
      keyFingerprint: identity.keyFingerprint,
      publicKeyX: identity.publicKey.x,
      deviceId: claim.device.id,
      endpoints: manifest.endpoints,
    },
    edgeCredentials: manifest.edgeCredentials,
    session: { token: claim.token, session: claim.session, refreshToken: claim.refreshToken },
  };
}

/**
 * Trades a refresh token for a new bearer and refresh token (`POST /api/v1/auth/refresh`). The
 * request carries no bearer: the refresh token is the credential. A refused token throws `ApiError`.
 */
export async function renewPaired(request: ApiRequest, refreshToken: string): Promise<StoredSession> {
  const result = await request<{ session: Session; token: string; refreshToken: string }>("/api/v1/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  });
  return { token: result.token, session: result.session, refreshToken: result.refreshToken };
}

/**
 * Re-reads the household's routes (`GET /api/v1/connection`) and keeps them only when the manifest
 * is signed by the key the phone already trusts; Access tokens only move up in version.
 */
export async function refreshRoutes(
  request: ApiRequest,
  profile: ConnectionProfile,
  held: EndpointCredential[],
): Promise<{ profile: ConnectionProfile; edgeCredentials: EndpointCredential[] }> {
  const connection = await request<{ endpointManifest: EndpointManifest }>("/api/v1/connection");
  const manifest = verifyManifest(connection.endpointManifest, profile.publicKeyX, profile.instanceId);
  return {
    profile: { ...profile, endpoints: manifest.endpoints },
    edgeCredentials: mergeEdgeCredentials(held, manifest.edgeCredentials),
  };
}
