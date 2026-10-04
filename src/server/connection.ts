import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { isServerOrigin } from "@/lib/pairing-code";
import { AccountKind, ConnectionTransport, ConnectionTrustMode, EdgeAuth, PairedDeviceClient, RouteKind, type Session } from "@prisma/client";
import { decryptSecret, encryptSecret, randomToken } from "./crypto";
import { prisma } from "./db";
import { edgeCredentials, recordDelivered } from "./edge-auth";

const SPKI_SHA256 = /^[A-Za-z0-9_-]{43}$/;

type ConnectionSession = Session & { account: { kind: AccountKind; isAdmin: boolean } | null; device?: { client: PairedDeviceClient } | null };

/**
 * Only a person in a browser, or their phone, may administer. A Watch or an agent is never an
 * administrator, whoever it acts as: its scope bounds it.
 */
export function isAdministrator(session: ConnectionSession): boolean {
  if (session.device && session.device.client !== PairedDeviceClient.phone) return false;
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

/**
 * The fields a route is served with, to administrators and phones alike. A `domain` route's tunnel
 * credential never is, and neither is an Access token: only whether one guards the route, and its version.
 */
export function publicEndpoint(endpoint: {
  id: string; url: string; kind: RouteKind; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256: string | null; priority: number; enabled: boolean;
  edgeAuth: EdgeAuth; edgeTokenVersion: number;
}) {
  return {
    id: endpoint.id, url: endpoint.url, kind: endpoint.kind, transport: endpoint.transport, trustMode: endpoint.trustMode, spkiSha256: endpoint.spkiSha256, priority: endpoint.priority, enabled: endpoint.enabled,
    edgeAuth: endpoint.edgeAuth, edgeTokenVersion: endpoint.edgeAuth === EdgeAuth.serviceToken ? endpoint.edgeTokenVersion : null,
  };
}

/** Quick and domain routes follow FamilyFi's own tunnel; only Remote access may change them. */
export function isManagedRoute(endpoint: { kind: RouteKind }): boolean {
  return endpoint.kind !== RouteKind.own;
}

/**
 * The routes phones may use, signed with the household key. A paired device (`deviceId`) also gets
 * the service tokens of the routes behind Cloudflare Access — never a browser session.
 */
export async function signedEndpointManifest(options: { deviceId?: string | null } = {}) {
  const household = await ensureConnectionIdentity();
  const endpoints = await prisma().connectionEndpoint.findMany({ where: { householdId: household.id, enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const credentials = options.deviceId ? edgeCredentials(endpoints) : [];
  const payload = JSON.stringify({
    instanceId: household.instanceId,
    endpoints: endpoints.map(publicEndpoint),
    ...(options.deviceId ? { edgeCredentials: credentials } : {}),
  });
  const privateJwk = JSON.parse(decryptSecret({
    ciphertext: Buffer.from(household.instancePrivateKeyCiphertext!), iv: Buffer.from(household.instancePrivateKeyIv!), authTag: Buffer.from(household.instancePrivateKeyAuthTag!),
  }));
  const { createPrivateKey } = await import("node:crypto");
  if (options.deviceId) await recordDelivered(options.deviceId, credentials);
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
  if (!isServerOrigin(value)) throw new Error("Endpoint must be an absolute HTTPS origin.");
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

export async function hasPendingPairing(endpointId: string): Promise<boolean> {
  return (await prisma().pairing.count({ where: { endpointId, claimedAt: null, expiresAt: { gt: new Date() } } })) > 0;
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

type Db = Parameters<Parameters<ReturnType<typeof prisma>["$transaction"]>[0]>[0];

/** Ends the sessions of a device's companions (a phone's Watches) and revokes them: they belong to it. */
async function revokeCompanions(id: string, db: Db, now: Date) {
  const companions = await db.pairedDevice.findMany({ where: { parentDeviceId: id, revokedAt: null }, select: { id: true } });
  if (!companions.length) return;
  const ids = companions.map((companion) => companion.id);
  await db.session.updateMany({ where: { deviceId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
  await db.pairedDevice.updateMany({ where: { id: { in: ids } }, data: { revokedAt: now } });
}

/**
 * Revokes a paired device and ends its sessions; a phone's Watches go with it. Resolves false when
 * there is no such device still active.
 */
export async function revokeDevice(id: string, db: Db = prisma() as unknown as Db, now = new Date()): Promise<boolean> {
  const updated = await db.pairedDevice.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } });
  if (!updated.count) return false;
  await db.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: now } });
  await revokeCompanions(id, db, now);
  return true;
}

/**
 * Deletes a paired device's record for good, signing out anything it still had; a phone's Watches
 * are revoked with it. Sessions, pairings and change history keep their rows with the device
 * reference cleared, so the Sync log still shows what changed, just not from which device.
 */
export async function removeDevice(id: string, db: Db = prisma() as unknown as Db, now = new Date()): Promise<boolean> {
  await db.session.updateMany({ where: { deviceId: id, revokedAt: null }, data: { revokedAt: now } });
  await revokeCompanions(id, db, now);
  const removed = await db.pairedDevice.deleteMany({ where: { id } });
  return removed.count === 1;
}

/**
 * An adult who is no longer an administrator keeps no paired devices: every phone, Watch and agent
 * acting as them is signed out and its record deleted, and any invite still pending for them is
 * cancelled, so a code made before the change cannot be claimed after it.
 */
export async function removeAccountDevices(accountId: string, db: Db = prisma() as unknown as Db, now = new Date()): Promise<number> {
  const devices = await db.pairedDevice.findMany({ where: { accountId }, select: { id: true } });
  for (const device of devices) await removeDevice(device.id, db, now);
  await db.pairing.updateMany({ where: { accountId, claimedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  return devices.length;
}

/** Deletes every revoked phone's record; the live-test harness alone can leave hundreds. */
export async function removeRevokedDevices(): Promise<number> {
  const removed = await prisma().pairedDevice.deleteMany({ where: { revokedAt: { not: null } } });
  return removed.count;
}
