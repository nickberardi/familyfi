import { PushChannel, PushPlatform, type PushRegistration } from "@prisma/client";
import { z } from "zod";
import { ALERT_KINDS, isAlertKind } from "@/lib/alert-kinds";
import { encryptSecret } from "../crypto";
import { prisma } from "../db";
import { isFullApp } from "../device-scope";
import { ApiError } from "../http";
import { parseAlertKey } from "./payload";

/**
 * A paired app's own push registration and alert choices. Only the app itself may touch them: an
 * administrator's browser, another phone, a Watch, Siri's `rulesOnly` sign-in and agents may not,
 * even though an `app:full` device counts as an administrator, so the own-id rule lives here rather
 * than in the guard (as `revokePairedDevice` does). The token and key are write-only.
 */

type Caller = { deviceId: string | null };

export const PushRegistrationInput = z.object({
  platform: z.enum(PushPlatform),
  channel: z.enum(PushChannel),
  token: z.string().trim().min(1).max(4096),
  key: z.string().min(1).max(64),
  format: z.number().int().min(1),
  kinds: z.array(z.string().max(64)).max(64),
});
export type PushRegistrationInput = z.infer<typeof PushRegistrationInput>;

/** Alert kinds a phone may turn on or off, each `true` when it gets them. */
export type AlertChoices = { kinds: Record<string, boolean> };

function notRegistered() {
  return new ApiError(404, "push_not_registered", "This device has not turned on alerts.");
}

/** The caller's own active app, or the refusal: 404 for no such device, 403 for anyone but the app itself. */
async function ownApp(session: Caller, id: string) {
  const device = await prisma().pairedDevice.findUnique({ where: { id } });
  if (!device || device.revokedAt) throw new ApiError(404, "not_found", "Paired device not found.");
  if (session.deviceId !== id || !isFullApp(device)) {
    throw new ApiError(403, "own_device_required", "Only the FamilyFi app on this device can change its alerts.");
  }
  return device;
}

function choices(registration: Pick<PushRegistration, "supportedKinds" | "mutedKinds">): AlertChoices {
  const kinds: Record<string, boolean> = {};
  for (const kind of ALERT_KINDS) {
    if (registration.supportedKinds.includes(kind)) kinds[kind] = !registration.mutedKinds.includes(kind);
  }
  return { kinds };
}

/** Stores or replaces this app's push token and key. Its alert choices stay as they were. */
export async function registerPush(session: Caller, id: string, input: PushRegistrationInput): Promise<AlertChoices> {
  await ownApp(session, id);
  const key = parseAlertKey(input.key);
  if (!key) throw new ApiError(400, "invalid_request", "key must be 32 bytes in base64.");
  const token = encryptSecret(input.token);
  const sealedKey = encryptSecret(key.toString("base64url"));
  // A kind this server does not know is dropped: the phone may be newer than the server.
  const supportedKinds = [...new Set(input.kinds.filter(isAlertKind))];
  const data = {
    platform: input.platform,
    channel: input.channel,
    tokenCiphertext: Uint8Array.from(token.ciphertext),
    tokenIv: Uint8Array.from(token.iv),
    tokenAuthTag: Uint8Array.from(token.authTag),
    keyCiphertext: Uint8Array.from(sealedKey.ciphertext),
    keyIv: Uint8Array.from(sealedKey.iv),
    keyAuthTag: Uint8Array.from(sealedKey.authTag),
    format: input.format,
    supportedKinds,
  };
  const registration = await prisma().pushRegistration.upsert({ where: { deviceId: id }, create: { deviceId: id, ...data }, update: data });
  // A new key cannot read alerts sealed for the old one.
  await prisma().alertEvent.deleteMany({ where: { deviceId: id, sentAt: null } });
  return choices(registration);
}

/** Forgets this app's token and key, and any alert still waiting for it. */
export async function removePush(session: Caller, id: string): Promise<void> {
  await ownApp(session, id);
  await prisma().$transaction([
    prisma().alertEvent.deleteMany({ where: { deviceId: id, sentAt: null } }),
    prisma().pushRegistration.deleteMany({ where: { deviceId: id } }),
  ]);
}

export async function getAlertChoices(session: Caller, id: string): Promise<AlertChoices> {
  await ownApp(session, id);
  const registration = await prisma().pushRegistration.findUnique({ where: { deviceId: id } });
  if (!registration) throw notRegistered();
  return choices(registration);
}

/**
 * Turns kinds on or off for this app. A kind left out keeps its choice; one this server does not know
 * is ignored, so a newer app can send its own list to an older server.
 */
export async function setAlertChoices(session: Caller, id: string, kinds: Record<string, boolean>): Promise<AlertChoices> {
  await ownApp(session, id);
  const registration = await prisma().pushRegistration.findUnique({ where: { deviceId: id } });
  if (!registration) throw notRegistered();
  const muted = new Set(registration.mutedKinds.filter(isAlertKind));
  for (const [kind, on] of Object.entries(kinds)) {
    if (!isAlertKind(kind)) continue;
    if (on) muted.delete(kind);
    else muted.add(kind);
  }
  const updated = await prisma().pushRegistration.update({ where: { deviceId: id }, data: { mutedKinds: [...muted].sort() } });
  if (muted.size) await prisma().alertEvent.deleteMany({ where: { deviceId: id, sentAt: null, kind: { in: [...muted] } } });
  return choices(updated);
}
