import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { AccountKind, ConnectionTransport, ConnectionTrustMode, type Session } from "@prisma/client";
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

export function publicEndpoint(endpoint: {
  id: string; url: string; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256: string | null; priority: number; enabled: boolean;
}) {
  return { id: endpoint.id, url: endpoint.url, transport: endpoint.transport, trustMode: endpoint.trustMode, spkiSha256: endpoint.spkiSha256, priority: endpoint.priority, enabled: endpoint.enabled };
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

export function assertEndpoint(input: { url: string; transport: ConnectionTransport; trustMode: ConnectionTrustMode; spkiSha256?: string | null }) {
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Endpoint must be an absolute HTTPS origin.");
  if (input.trustMode === ConnectionTrustMode.pinned && input.transport !== ConnectionTransport.lan) throw new Error("Only LAN endpoints may use a pinned certificate.");
  if (input.trustMode === ConnectionTrustMode.pinned && !input.spkiSha256) throw new Error("Pinned endpoints require an SPKI SHA-256 pin.");
  if (input.trustMode === ConnectionTrustMode.system && input.spkiSha256) throw new Error("System-trusted endpoints cannot include an SPKI pin.");
  if (input.spkiSha256 && !SPKI_SHA256.test(input.spkiSha256)) throw new Error("SPKI SHA-256 must be base64url SHA-256 data.");
  return url.origin;
}

export async function createPairing(input: { endpointId: string; displayName: string; createdByAccountId: string }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const pairing = await prisma().pairing.create({ data: { endpointId: input.endpointId, displayName: input.displayName, createdByAccountId: input.createdByAccountId, tokenHash: sha256(token), expiresAt }, include: { endpoint: true } });
  const household = await ensureConnectionIdentity();
  return {
    pairing,
    qr: { version: 1, pairingId: pairing.id, token, endpoint: publicEndpoint(pairing.endpoint), instanceId: household.instanceId, keyFingerprint: instanceFingerprint(household.instancePublicKey!) },
  };
}

export async function claimPairing(input: { id: string; token: string; displayName: string }) {
  const pairing = await prisma().pairing.findUnique({ where: { id: input.id }, include: { endpoint: true } });
  if (!pairing || pairing.claimedAt || pairing.expiresAt <= new Date() || !safeEqual(pairing.tokenHash, sha256(input.token))) return null;
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
