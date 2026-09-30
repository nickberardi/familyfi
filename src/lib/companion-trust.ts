import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { base64UrlDecode, base64UrlEncode, utf8Decode } from "./base64url";
import { isEdgeHeaderValue, isServerOrigin, type EdgeCredential } from "./pairing-code";
import type { ConnectionRoute } from "./types";

/**
 * How a companion (a paired phone) decides to trust a household, and which of its routes to use.
 * Nothing is trusted until it verifies: an identity whose fingerprint is not the hash of its key, or
 * that disagrees with the pairing code, is refused; a route list counts only when the household's
 * key signed it. See docs/api.md, "Companion connection and HTTPS".
 */

/** What `GET /api/v1/connection/identity` returns. */
export type ConnectionIdentity = {
  protocolVersion: number;
  householdName: string;
  instanceId: string;
  publicKey: { kty: "OKP"; crv: "Ed25519"; x: string };
  keyFingerprint: string;
};

/** The signed route list, as the claim and `GET /api/v1/connection` return it. */
export type EndpointManifest = { signedPayload: string; signature: string };

/** An Access credential bound to one route of a manifest. */
export type EndpointCredential = EdgeCredential & { endpointId: string };

export type VerifiedManifest = { endpoints: ConnectionRoute[]; edgeCredentials: EndpointCredential[] };

export class TrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustError";
  }
}

export const IDENTITY_FINGERPRINT_INVALID = "The server signing-key fingerprint is invalid.";
export const IDENTITY_MISMATCH = "The server signing key does not match the pairing code.";
export const MANIFEST_SIGNATURE_INVALID = "The endpoint manifest signature is invalid.";
export const MANIFEST_WRONG_HOUSEHOLD = "The endpoint manifest belongs to a different FamilyFi household.";
export const MANIFEST_MISSING_ENDPOINT = "The endpoint manifest does not include the route this phone paired over.";
export const EDGE_CREDENTIAL_INVALID = "FamilyFi returned an invalid Access credential binding.";

/** base64url SHA-256 of some bytes: a key fingerprint or a certificate pin. */
export function sha256Base64Url(bytes: Uint8Array): string {
  return base64UrlEncode(sha256(bytes));
}

/**
 * The household's fingerprint must be the hash of the key it presents, and the one the pairing code
 * committed to. No instance id is compared: the fingerprint binds the household key, and the
 * claim's manifest, signed by that key, carries the instance id.
 */
export function verifyIdentity(identity: Pick<ConnectionIdentity, "keyFingerprint" | "publicKey">, expectedFingerprint: string): void {
  const key = base64UrlDecode(identity.publicKey.x);
  if (!key || key.length !== 32 || identity.keyFingerprint !== sha256Base64Url(key)) throw new TrustError(IDENTITY_FINGERPRINT_INVALID);
  if (identity.keyFingerprint !== expectedFingerprint) throw new TrustError(IDENTITY_MISMATCH);
}

/**
 * Checks a manifest's Ed25519 signature with the household's key, that it names this household, and
 * that every route and credential in it is well formed. Returns what it signed; the unsigned copies
 * of `instanceId` and `endpoints` beside it in a response are never read.
 */
export function verifyManifest(manifest: EndpointManifest, publicKeyX: string, instanceId: string): VerifiedManifest {
  const payload = base64UrlDecode(manifest.signedPayload);
  const signature = base64UrlDecode(manifest.signature);
  const key = base64UrlDecode(publicKeyX);
  let valid = false;
  try {
    valid = !!payload && !!signature && !!key && ed25519.verify(signature, payload, key);
  } catch {
    valid = false;
  }
  if (!valid) throw new TrustError(MANIFEST_SIGNATURE_INVALID);

  let body: { instanceId?: unknown; endpoints?: unknown; edgeCredentials?: unknown };
  try {
    body = JSON.parse(utf8Decode(payload!) ?? "");
  } catch {
    throw new TrustError(MANIFEST_SIGNATURE_INVALID);
  }
  if (body.instanceId !== instanceId) throw new TrustError(MANIFEST_WRONG_HOUSEHOLD);
  if (!Array.isArray(body.endpoints) || (body.edgeCredentials !== undefined && !Array.isArray(body.edgeCredentials))) {
    throw new TrustError(EDGE_CREDENTIAL_INVALID);
  }
  const verified = { endpoints: body.endpoints as ConnectionRoute[], edgeCredentials: (body.edgeCredentials ?? []) as EndpointCredential[] };
  validateManifest(verified);
  return verified;
}

/** Every route an HTTPS origin, ids unique, and each route's Access credential matching its binding. */
export function validateManifest({ endpoints, edgeCredentials }: VerifiedManifest): void {
  const ids = new Set(endpoints.map((endpoint) => endpoint.id));
  const bound = new Set(edgeCredentials.map((credential) => credential.endpointId));
  if (ids.size !== endpoints.length || bound.size !== edgeCredentials.length) throw new TrustError(EDGE_CREDENTIAL_INVALID);
  for (const endpoint of endpoints) {
    if (typeof endpoint.url !== "string" || !isServerOrigin(endpoint.url)) throw new TrustError(EDGE_CREDENTIAL_INVALID);
    validateEdgeCredential(edgeCredentials.find((credential) => credential.endpointId === endpoint.id) ?? null, endpoint);
  }
  if (!edgeCredentials.every((credential) => ids.has(credential.endpointId))) throw new TrustError(EDGE_CREDENTIAL_INVALID);
}

/**
 * A route without Access carries no credential and no token version. A route behind Access is a
 * system-trusted Cloudflare route whose credential has the route's current version and printable
 * header values.
 */
export function validateEdgeCredential(credential: EdgeCredential | null, endpoint: ConnectionRoute): void {
  if (endpoint.edgeAuth === "none") {
    if (credential !== null || endpoint.edgeTokenVersion !== null) throw new TrustError(EDGE_CREDENTIAL_INVALID);
    return;
  }
  if (
    endpoint.transport !== "cloudflare" ||
    endpoint.trustMode !== "system" ||
    !endpoint.enabled ||
    !isServerOrigin(endpoint.url) ||
    !credential ||
    !(credential.version > 0) ||
    credential.version !== endpoint.edgeTokenVersion ||
    !isEdgeHeaderValue(credential.clientId) ||
    !isEdgeHeaderValue(credential.clientSecret)
  ) {
    throw new TrustError(EDGE_CREDENTIAL_INVALID);
  }
}

/** Throws unless the route the phone paired over is in the signed manifest, by origin. */
export function requireEndpoint(manifest: VerifiedManifest, url: string): void {
  if (!manifest.endpoints.some((endpoint) => endpoint.url === url)) throw new TrustError(MANIFEST_MISSING_ENDPOINT);
}

/**
 * The routes to try, best first: the enabled ones, in the manifest's order, which the server sorts
 * by priority and then creation (`src/server/connection.ts`), as the web's route list shows them.
 */
export function candidateRoutes(endpoints: ConnectionRoute[]): ConnectionRoute[] {
  return endpoints.filter((endpoint) => endpoint.enabled);
}

/**
 * The Access credentials to keep after a verified manifest: a route's token is replaced only by a
 * higher version, and a version once seen always means the same token. Throws when a manifest
 * repeats a version with a different token, or offers a lower one.
 */
export function mergeEdgeCredentials(held: EndpointCredential[], incoming: EndpointCredential[]): EndpointCredential[] {
  const next = new Map(held.map((credential) => [credential.endpointId, credential]));
  for (const credential of incoming) {
    const current = next.get(credential.endpointId);
    if (current) {
      if (credential.version < current.version) throw new TrustError(EDGE_CREDENTIAL_INVALID);
      if (credential.version === current.version && (credential.clientId !== current.clientId || credential.clientSecret !== current.clientSecret)) {
        throw new TrustError(EDGE_CREDENTIAL_INVALID);
      }
    }
    next.set(credential.endpointId, credential);
  }
  return [...next.values()];
}

/** The Access headers for a request to a route, or none: only to that route's origin, and only at its current token version. */
export function edgeHeaders(endpoint: ConnectionRoute, credentials: EndpointCredential[]): Record<string, string> {
  if (endpoint.edgeAuth !== "serviceToken") return {};
  const credential = credentials.find((item) => item.endpointId === endpoint.id && item.version === endpoint.edgeTokenVersion);
  return credential ? { "CF-Access-Client-Id": credential.clientId, "CF-Access-Client-Secret": credential.clientSecret } : {};
}

/**
 * Whether a response came from Cloudflare Access rather than FamilyFi: a redirect to its sign-in, or
 * a 401 or 403 without FamilyFi's `{ error: { code, message } }` body. Such a route is unavailable:
 * fail over, and never sign out.
 */
export function isEdgeUnavailable(response: { status: number; location?: string | null; body?: unknown }): boolean {
  if (response.status >= 300 && response.status < 400) {
    try {
      return !!response.location && new URL(response.location).hostname.endsWith(".cloudflareaccess.com");
    } catch {
      return false;
    }
  }
  if (response.status !== 401 && response.status !== 403) return false;
  const error = (response.body as { error?: { code?: unknown; message?: unknown } } | null | undefined)?.error;
  return !(error && typeof error.code === "string" && typeof error.message === "string");
}
