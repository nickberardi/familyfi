import { PAIRING_CODE_VERSION, type PairingPayload } from "@/lib/pairing-code";

/** The pairing code's format and its client-side parser live in `src/lib/pairing-code.ts`, shared with the native app. */
export { PAIRING_CODE_VERSION, type PairingPayload };

export function encodePairingCode(payload: PairingPayload): string {
  if (payload.pin && payload.access) throw new Error("A pairing code carries a certificate pin or an Access token, never both.");
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
