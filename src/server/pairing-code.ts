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

export function encodePairingCode(payload: PairingPayload): string {
  if (payload.pin && payload.access) throw new Error("A pairing code carries a certificate pin or an Access token, never both.");
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
