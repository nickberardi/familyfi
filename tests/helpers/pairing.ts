import { expect } from "vitest";
import type { PairingPayload } from "@/server/pairing-code";

/** What a phone reads out of a pairing code: the decoded payload, and the claim's id and token. */
export function decodePairingCode(pairingCode: string): { payload: PairingPayload; pairingId: string; token: string } {
  expect(pairingCode).toMatch(/^[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(Buffer.from(pairingCode, "base64url").toString("utf8")) as PairingPayload;
  const dot = payload.code.indexOf(".");
  return { payload, pairingId: payload.code.slice(0, dot), token: payload.code.slice(dot + 1) };
}

/** A `POST /connection/pairings` body, decoded the way the phone would. */
export async function issuedPairing(response: Response) {
  const { pairing } = (await response.json()) as { pairing: { id: string; expiresAt: string; pairingCode: string } };
  const decoded = decodePairingCode(pairing.pairingCode);
  expect(decoded.pairingId).toBe(pairing.id);
  return { id: pairing.id, pairingCode: pairing.pairingCode, ...decoded };
}
