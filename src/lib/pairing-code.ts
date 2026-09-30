import { base64UrlDecode, utf8Decode } from "./base64url";
import type { ConnectionRoute } from "./types";

/**
 * The pairing code: the one string an administrator hands a phone, whether the phone scans it as a
 * QR or pastes it. It is `base64url(JSON)` with no padding, so it survives a clipboard, a chat
 * message or a link without quoting.
 *
 * It carries only what pairing needs. Everything else about the route — its id, priority, and the
 * service token's version — comes in the signed manifest the claim returns, which is the authority
 * from then on. The household is bound by `fingerprint` (the SHA-256 of its signing key), so no
 * separate instance id is needed: the manifest's instance id is signed by that key.
 */
export type PairingPayload = {
  version: 1;
  /** The HTTPS origin the phone pairs over. */
  url: string;
  /** The single-use claim: `pairingId.token`. */
  code: string;
  /** base64url SHA-256 of the household's signing key. */
  fingerprint: string;
  /** A LAN route's certificate pin (base64url SHA-256 of the leaf SPKI). Never with `access`. */
  pin?: string;
  /** A Cloudflare Access service token, for a route behind Access. Never with `pin`. */
  access?: { clientId: string; clientSecret: string };
};

export const PAIRING_CODE_VERSION = 1;

/** A Cloudflare Access service token and the version the household issued it under. */
export type EdgeCredential = { version: number; clientId: string; clientSecret: string };

/** A pairing code a phone has read, checked before anything touches the network. */
export type PairingCode = {
  pairingId: string;
  token: string;
  /**
   * A stand-in for the route the code names, only to reach the household and verify it; the claim's
   * signed manifest replaces it.
   */
  endpoint: ConnectionRoute;
  keyFingerprint: string;
  /** The code's Access token, which only bootstraps pairing; the manifest delivers the one kept. */
  edgeCredential: EdgeCredential | null;
};

export class PairingCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingCodeError";
  }
}

export const PAIRING_CODE_INVALID = "This isn't a FamilyFi pairing code.";
export const PAIRING_CODE_NEWER = "This pairing code is from a newer FamilyFi. Update the app, or make a new code.";
export const PAIRING_CODE_INCOMPLETE = "This pairing code is incomplete. Make a new code and copy all of it.";

/**
 * Whether a value is an HTTPS origin and nothing more: no credentials, path, query or fragment. Both
 * pairing codes and manifest routes must name one.
 */
export function isServerOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search === "" &&
    url.hash === ""
  );
}

const PIN = /^[A-Za-z0-9_-]{43}$/;
const HEADER_VALUE = /^[\x21-\x7e]{1,512}$/;

/** Whether an Access credential may be sent as the CF-Access headers of a route: printable ASCII, at most 512 bytes. */
export function isEdgeHeaderValue(value: string): boolean {
  return HEADER_VALUE.test(value);
}

/**
 * Reads a scanned or pasted pairing code. Camera and paste both come through here, so a code that
 * names no HTTPS origin, no household fingerprint, or both a pin and an Access token is refused
 * before anything touches the network. Throws a `PairingCodeError` whose message is shown as is.
 */
export function parsePairingCode(value: string): PairingCode {
  const bytes = base64UrlDecode(value.replace(/\s/g, ""));
  const text = bytes && bytes.length ? utf8Decode(bytes) : null;
  let payload: Record<string, unknown>;
  try {
    payload = text === null ? null : JSON.parse(text);
  } catch {
    throw new PairingCodeError(PAIRING_CODE_INVALID);
  }
  if (!payload || typeof payload !== "object" || typeof payload.version !== "number" || typeof payload.code !== "string" || typeof payload.url !== "string" || typeof payload.fingerprint !== "string") {
    throw new PairingCodeError(PAIRING_CODE_INVALID);
  }
  if (payload.version !== PAIRING_CODE_VERSION) throw new PairingCodeError(PAIRING_CODE_NEWER);

  const dot = payload.code.indexOf(".");
  const pairingId = dot < 0 ? "" : payload.code.slice(0, dot);
  const token = dot < 0 ? "" : payload.code.slice(dot + 1);
  const pin = payload.pin;
  const access = payload.access as { clientId?: unknown; clientSecret?: unknown } | undefined;
  if (
    !pairingId ||
    !token ||
    !isServerOrigin(payload.url.trim()) ||
    !payload.fingerprint ||
    (pin !== undefined && access !== undefined) ||
    (pin !== undefined && (typeof pin !== "string" || !PIN.test(pin))) ||
    (access !== undefined &&
      (typeof access !== "object" ||
        access === null ||
        typeof access.clientId !== "string" ||
        typeof access.clientSecret !== "string" ||
        !isEdgeHeaderValue(access.clientId) ||
        !isEdgeHeaderValue(access.clientSecret)))
  ) {
    throw new PairingCodeError(PAIRING_CODE_INCOMPLETE);
  }

  const url = new URL(payload.url.trim()).origin;
  const base = { id: "pairing", url, kind: "own" as const, priority: 0, enabled: true };
  if (typeof pin === "string") {
    return {
      pairingId,
      token,
      keyFingerprint: payload.fingerprint,
      edgeCredential: null,
      endpoint: { ...base, transport: "lan", trustMode: "pinned", spkiSha256: pin, edgeAuth: "none", edgeTokenVersion: null },
    };
  }
  if (access) {
    // The code's token only bootstraps pairing; the manifest delivers the versioned token this
    // phone keeps, so the stand-in endpoint and credential share version 1.
    return {
      pairingId,
      token,
      keyFingerprint: payload.fingerprint,
      edgeCredential: { version: 1, clientId: access.clientId as string, clientSecret: access.clientSecret as string },
      endpoint: { ...base, transport: "cloudflare", trustMode: "system", spkiSha256: null, edgeAuth: "serviceToken", edgeTokenVersion: 1 },
    };
  }
  return {
    pairingId,
    token,
    keyFingerprint: payload.fingerprint,
    edgeCredential: null,
    endpoint: { ...base, transport: "lan", trustMode: "system", spkiSha256: null, edgeAuth: "none", edgeTokenVersion: null },
  };
}
