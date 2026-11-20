import { z } from "zod";
import { randomToken } from "./crypto";

/**
 * A paired device's bearer and refresh tokens. Each is a random string, and only its SHA-256 hash is
 * stored, so the server finds the session by hashing the whole token as it arrives.
 *
 * An app from 2.0 on says which version it runs when it claims its pairing code and when it refreshes
 * its tokens (`appVersion`). Its tokens then carry a payload, base64url JSON
 * `{ "v": 1, "appVersion": "2.1.0", "token": "<random>" }`, so every request it makes says which app
 * sent it. An app before 2.0 never says, and keeps getting a bare random string, which never decodes
 * to that payload (base64url of 32 random bytes is 43 characters). The payload is not a secret and is
 * not signed: it can't be changed without changing the token, whose hash then matches no session.
 */
export const DEVICE_TOKEN_VERSION = 1;

/** The app version a device may send: semver, as the apps' own versions are. */
export const AppVersion = z
  .string()
  .max(64)
  .regex(/^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,6}([-+][0-9A-Za-z.-]+)?$/, "appVersion must be a version such as 2.1.0.");

/** A new token: bare for a device that named no app version, else carrying that version. */
export function newDeviceToken(appVersion?: string | null): string {
  const token = randomToken();
  if (!appVersion) return token;
  return Buffer.from(JSON.stringify({ v: DEVICE_TOKEN_VERSION, appVersion, token })).toString("base64url");
}

/** The app version a presented token carries, or null for a bare token (an app before 2.0, or a browser's cookie). */
export function deviceTokenAppVersion(token: string): string | null {
  // A bare token is 43 characters; anything that short has no payload to read.
  if (token.length <= 43) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const { v, appVersion, token: inner } = payload as Record<string, unknown>;
  if (v !== DEVICE_TOKEN_VERSION || typeof inner !== "string" || !AppVersion.safeParse(appVersion).success) return null;
  return appVersion as string;
}
