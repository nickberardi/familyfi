import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AlertEnvelope } from "@/lib/alert-kinds";

/**
 * The encryption of one alert for one phone. The phone made the 32-byte key and gave it only to this
 * server, so the relay, Apple and Google carry the result without being able to read it.
 *
 * Wire form: base64url of `0x01 || 12-byte nonce || AES-256-GCM ciphertext || 16-byte tag`, with the
 * additional data `familyfi-alert-v1`. The leading byte is the format of this framing, not of the
 * envelope inside, which carries its own `v`.
 */

const FRAME_VERSION = 1;
const AAD = Buffer.from("familyfi-alert-v1", "utf8");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
export const ALERT_KEY_BYTES = 32;
/** The server refuses to send anything longer; a push body has room for far more, a phone needs far less. */
export const ALERT_CIPHERTEXT_MAX_CHARS = 1024;

export class AlertTooLargeError extends Error {}

export function encryptAlert(key: Buffer, envelope: AlertEnvelope, nonce: Buffer = randomBytes(NONCE_BYTES)): string {
  if (key.length !== ALERT_KEY_BYTES) throw new Error("An alert key is 32 bytes.");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(envelope), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([Buffer.from([FRAME_VERSION]), nonce, body, cipher.getAuthTag()]).toString("base64url");
  if (sealed.length > ALERT_CIPHERTEXT_MAX_CHARS) throw new AlertTooLargeError("An alert is too large to send.");
  return sealed;
}

/** What a phone does with an alert, in TypeScript: for tests and for the vectors the apps' ports check against. */
export function decryptAlert(key: Buffer, sealed: string): AlertEnvelope {
  const frame = Buffer.from(sealed, "base64url");
  if (frame.length < 1 + NONCE_BYTES + TAG_BYTES || frame[0] !== FRAME_VERSION) throw new Error("Not a FamilyFi alert.");
  const nonce = frame.subarray(1, 1 + NONCE_BYTES);
  const tag = frame.subarray(frame.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(frame.subarray(1 + NONCE_BYTES, frame.length - TAG_BYTES)), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as AlertEnvelope;
}

/** A phone's key as it sends it: standard or URL-safe base64 of exactly 32 bytes, or null. */
export function parseAlertKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const key = Buffer.from(value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "base64url");
  return key.length === ALERT_KEY_BYTES ? key : null;
}
