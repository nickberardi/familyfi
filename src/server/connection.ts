import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { AccountKind, ConnectionTransport, ConnectionTrustMode, PairedDeviceClient, RouteKind, SessionKind, type Session } from "@prisma/client";
import { SESSION_TTL_MS } from "@/lib/constants";
import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const SPKI_SHA256 = /^[A-Za-z0-9_-]{43}$/;

type ConnectionSession = Session & { account: { kind: AccountKind; isAdmin: boolean } | null };

export function isAdministrator(session: ConnectionSession): boolean {
  return session.account?.kind === AccountKind.recovery || session.account?.isAdmin === true;
}

export async function ensureConnectionIdentity() {
  await prisma().household.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (household.instanceId && household.instancePublicKey && household.instancePrivateKeyCiphertext && household.instancePrivateKeyIv && household.instancePrivateKeyAuthTag) {
    return household;
  }
  const keys = generateKeyPairSync("ed25519");
  const publicKey = JSON.stringify(keys.publicKey.export({ format: "jwk" }));
  const privateKey = JSON.stringify(keys.privateKey.export({ format: "jwk" }));
  const secret = encryptSecret(privateKey);
  return prisma().household.update({
    where: { id: "default" },
    data: {
      instanceId: `ff_${randomToken(12)}`,
      instancePublicKey: publicKey,
      instancePrivateKeyCiphertext: new Uint8Array(secret.ciphertext),
      instancePrivateKeyIv: new Uint8Array(secret.iv),
      instancePrivateKeyAuthTag: new Uint8Array(secret.authTag),
    },
  });
}

export function instanceFingerprint(publicKey: string): string {
  const jwk = JSON.parse(publicKey) as { x: string };
  return createHash("sha256").update(Buffer.from(jwk.x, "base64url")).digest("base64url");
}

/** The fields a route is served with, to administrators and phones alike. A `domain` route's tunnel credential never is. */
export function publicEndpoint(endpoint: {
  id: string; url: string; kind: RouteKind; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256: string | null; priority: number; enabled: boolean;
}) {
  return { id: endpoint.id, url: endpoint.url, kind: endpoint.kind, transport: endpoint.transport, trustMode: endpoint.trustMode, spkiSha256: endpoint.spkiSha256, priority: endpoint.priority, enabled: endpoint.enabled };
}

/** Quick and domain routes follow FamilyFi's own tunnel; only Remote access may change them. */
export function isManagedRoute(endpoint: { kind: RouteKind }): boolean {
  return endpoint.kind !== RouteKind.own;
}

export async function signedEndpointManifest() {
  const household = await ensureConnectionIdentity();
  const endpoints = await prisma().connectionEndpoint.findMany({ where: { householdId: household.id, enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const payload = JSON.stringify({ instanceId: household.instanceId, endpoints: endpoints.map(publicEndpoint) });
  const privateJwk = JSON.parse(decryptSecret({
    ciphertext: Buffer.from(household.instancePrivateKeyCiphertext!), iv: Buffer.from(household.instancePrivateKeyIv!), authTag: Buffer.from(household.instancePrivateKeyAuthTag!),
  }));
  const { createPrivateKey } = await import("node:crypto");
  return {
    instanceId: household.instanceId!,
    endpoints: endpoints.map(publicEndpoint),
    signedPayload: Buffer.from(payload).toString("base64url"),
    signature: sign(null, Buffer.from(payload), createPrivateKey({ key: privateJwk, format: "jwk" })).toString("base64url"),
  };
}

/** A route is a bare HTTPS origin: no credentials, path, query or fragment. */
export function httpsOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Endpoint must be an absolute HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Endpoint must be an absolute HTTPS origin.");
  return url;
}

export function assertEndpoint(input: { url: string; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256?: string | null }) {
  const url = httpsOrigin(input.url);
  if (input.trustMode === ConnectionTrustMode.pinned && input.transport !== ConnectionTransport.lan) throw new Error("Only LAN endpoints may use a pinned certificate.");
  if (input.trustMode === ConnectionTrustMode.pinned && !input.spkiSha256) throw new Error("Pinned endpoints require an SPKI SHA-256 pin.");
  if (input.trustMode === ConnectionTrustMode.system && input.spkiSha256) throw new Error("System-trusted endpoints cannot include an SPKI pin.");
  if (input.spkiSha256 && !SPKI_SHA256.test(input.spkiSha256)) throw new Error("SPKI SHA-256 must be base64url SHA-256 data.");
  return url.origin;
}

export async function createPairing(input: { endpointId: string; displayName: string; createdByAccountId: string; replacesDeviceId?: string | null }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const pairing = await prisma().pairing.create({ data: { endpointId: input.endpointId, displayName: input.displayName, createdByAccountId: input.createdByAccountId, replacesDeviceId: input.replacesDeviceId ?? null, tokenHash: sha256(token), expiresAt }, include: { endpoint: true } });
  const household = await ensureConnectionIdentity();
  return {
    pairing,
    qr: { version: 1, pairingId: pairing.id, token, endpoint: publicEndpoint(pairing.endpoint!), instanceId: household.instanceId, keyFingerprint: instanceFingerprint(household.instancePublicKey!) },
  };
}

export async function claimPairing(input: { id: string; token: string; displayName: string }) {
  const pairing = await prisma().pairing.findUnique({ where: { id: input.id }, include: { endpoint: true } });
  if (!pairing || !pairing.endpoint || pairing.claimedAt || pairing.expiresAt <= new Date() || !safeEqual(pairing.tokenHash, sha256(input.token))) return null;
  const credential = randomToken();
  const now = new Date();
  const device = await prisma().$transaction(async (transaction) => {
    const claimed = await transaction.pairing.updateMany({
      where: { id: pairing.id, claimedAt: null, expiresAt: { gt: now } },
      data: { claimedAt: now },
    });
    if (claimed.count !== 1) return null;
    const pairedDevice = await transaction.pairedDevice.create({
      data: { displayName: input.displayName, credentialHash: sha256(credential), lastSeenAt: now },
    });
    await transaction.pairing.update({ where: { id: pairing.id }, data: { claimedDeviceId: pairedDevice.id } });
    // A re-pair retires the record it replaces, so the same phone is never listed twice.
    if (pairing.replacesDeviceId) await removeDevice(pairing.replacesDeviceId, transaction, now);
    return pairedDevice;
  });
  if (!device) return null;
  return { device, credential, endpoint: publicEndpoint(pairing.endpoint), manifest: await signedEndpointManifest() };
}

export async function authenticatePairedDevice(id: string, credential: string) {
  const device = await prisma().pairedDevice.findUnique({ where: { id } });
  if (!device || device.revokedAt || !safeEqual(device.credentialHash, sha256(credential))) return null;
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (!device.lastSeenAt || device.lastSeenAt < fifteenMinutesAgo) await prisma().pairedDevice.update({ where: { id }, data: { lastSeenAt: new Date() } });
  return device;
}

/** Enroll the Watch reached by the signed-in phone as its own paired device. */
export async function enrollWatch(input: { clientId: string; accountId: string; username: string; displayName: string }) {
  const credential = randomToken();
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const result = await prisma().$transaction(async (transaction) => {
    const previous = await transaction.pairedDevice.findUnique({ where: { clientId: input.clientId } });
    if (previous) {
      await transaction.session.updateMany({ where: { deviceId: previous.id, revokedAt: null }, data: { revokedAt: now } });
      await transaction.pairedDevice.update({ where: { id: previous.id }, data: { revokedAt: now, clientId: null } });
    }
    const device = await transaction.pairedDevice.create({
      data: {
        displayName: input.displayName,
        credentialHash: sha256(credential),
        client: PairedDeviceClient.watch,
        clientId: input.clientId,
        lastSeenAt: now,
      },
    });
    const session = await transaction.session.create({
      data: {
        tokenHash: sha256(token),
        kind: SessionKind.bearer,
        accountId: input.accountId,
        username: input.username,
        deviceId: device.id,
        expiresAt,
      },
    });
    return { device, session };
  });
  return { deviceId: result.device.id, deviceCredential: credential, sessionId: result.session.id, token, expiresAt };
}

export type PairingStatus = "pending" | "claimed" | "expired";

export function pairingStatus(pairing: { claimedAt: Date | null; expiresAt: Date }, now = new Date()): PairingStatus {
  if (pairing.claimedAt) return "claimed";
  return pairing.expiresAt <= now ? "expired" : "pending";
}

/** Ends a pending pairing early. Expiring it, rather than deleting it, keeps the claim path's single check. */
export async function cancelPairing(id: string): Promise<boolean> {
  const now = new Date();
  const cancelled = await prisma().pairing.updateMany({ where: { id, claimedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  return cancelled.count === 1;
}

export async function hasPendingPairing(endpointId: string): Promise<boolean> {
  return (await prisma().pairing.count({ where: { endpointId, claimedAt: null, expiresAt: { gt: new Date() } } })) > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

type Db = Parameters<Parameters<ReturnType<typeof prisma>["$transaction"]>[0]>[0];

/**
 * Deletes a paired phone's record for good, signing out anything it still had. Sessions,
 * pairings and change history keep their rows with the phone reference cleared, so the
 * Sync log still shows what changed, just not from which phone.
 */
export async function removeDevice(id: string, db: Db = prisma() as unknown as Db, now = new Date()): Promise<boolean> {
  await db.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: now } });
  const removed = await db.pairedDevice.deleteMany({ where: { id } });
  return removed.count === 1;
}

/** Deletes every revoked phone's record; the live-test harness alone can leave hundreds. */
export async function removeRevokedDevices(): Promise<number> {
  const removed = await prisma().pairedDevice.deleteMany({ where: { revokedAt: { not: null } } });
  return removed.count;
}
