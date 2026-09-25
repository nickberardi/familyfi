/**
 * Cloudflare Access in front of a route the household runs. Cloudflare turns away any request
 * without the route's service token, so phones must carry it: FamilyFi stores the token the
 * operator pastes, encrypted, and hands it only to phones — in the pairing QR and in a paired
 * device's signed manifest. It is a second barrier, not a replacement: a request that gets past
 * Cloudflare still needs a paired device and a signed-in account.
 *
 * FamilyFi never holds an old token. Cloudflare keeps the old one valid through a rotation; what
 * FamilyFi tracks is which version each device was last handed, so the operator can see when
 * every phone has the new one.
 */
import { ConnectionTransport, EdgeAuth, RouteKind, type ConnectionEndpoint } from "@prisma/client";
import { decryptSecret, encryptSecret, safeEqual } from "./crypto";
import { prisma } from "./db";

/** How long a device counts as in use: Cloudflare's longest grace period for a rotated secret. */
export const ACTIVE_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Both halves travel as HTTP header values, so only visible ASCII — never whitespace or a line break. */
const HEADER_VALUE = /^[\x21-\x7e]{1,512}$/;

export type ServiceToken = { clientId: string; clientSecret: string };

/** What a phone receives for a protected route. */
export type EdgeCredential = ServiceToken & { endpointId: string; version: number };

export type EdgeTokenInput = { edgeAuth?: EdgeAuth; serviceToken?: ServiceToken };

type EdgeColumns = Pick<
  ConnectionEndpoint,
  "edgeAuth" | "edgeTokenCiphertext" | "edgeTokenIv" | "edgeTokenAuthTag" | "edgeTokenVersion" | "edgeTokenRotatedAt"
>;

type RouteShape = Pick<ConnectionEndpoint, "kind" | "transport"> & EdgeColumns;

export class EdgeAuthError extends Error {
  constructor(
    readonly status: 400 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Only a Cloudflare Tunnel the household runs can sit behind Access; FamilyFi's own tunnels and other transports cannot. */
export function canUseAccess(route: Pick<ConnectionEndpoint, "kind" | "transport">): boolean {
  return route.kind === RouteKind.own && route.transport === ConnectionTransport.cloudflare;
}

/** The stored token, or null when there is none or it can no longer be decrypted (a changed FAMILYFI_ENCRYPTION_KEY). */
export function storedServiceToken(route: EdgeColumns): ServiceToken | null {
  if (route.edgeAuth !== EdgeAuth.serviceToken || !route.edgeTokenCiphertext || !route.edgeTokenIv || !route.edgeTokenAuthTag) return null;
  try {
    const parsed = JSON.parse(
      decryptSecret({ ciphertext: Buffer.from(route.edgeTokenCiphertext), iv: Buffer.from(route.edgeTokenIv), authTag: Buffer.from(route.edgeTokenAuthTag) }),
    ) as Partial<ServiceToken>;
    return typeof parsed.clientId === "string" && typeof parsed.clientSecret === "string" ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret } : null;
  } catch {
    return null;
  }
}

function sameToken(a: ServiceToken, b: ServiceToken): boolean {
  return safeEqual(a.clientId, b.clientId) && safeEqual(a.clientSecret, b.clientSecret);
}

/**
 * The column changes a route create or update makes to its Access token, checked against the
 * route as it will be saved. `cleared` means Access went off, so the delivery records go too.
 * Pasting a different token is a rotation; pasting the same one changes nothing.
 */
export function edgeTokenUpdate(route: RouteShape, input: EdgeTokenInput, now = new Date()): { data: Partial<EdgeColumns>; cleared: boolean } {
  const wantsAccess = input.serviceToken !== undefined || input.edgeAuth === EdgeAuth.serviceToken || (input.edgeAuth === undefined && route.edgeAuth === EdgeAuth.serviceToken);
  if (input.edgeAuth === EdgeAuth.none && input.serviceToken) {
    throw new EdgeAuthError(400, "invalid_request", "Send a service token or turn Cloudflare Access off, not both.");
  }
  if (!wantsAccess) {
    if (route.edgeAuth === EdgeAuth.none) return { data: {}, cleared: false };
    return {
      data: { edgeAuth: EdgeAuth.none, edgeTokenCiphertext: null, edgeTokenIv: null, edgeTokenAuthTag: null, edgeTokenRotatedAt: null },
      cleared: true,
    };
  }
  if (!canUseAccess(route)) {
    throw new EdgeAuthError(409, "access_unsupported", "Only a Cloudflare Tunnel you run can be protected with Cloudflare Access.");
  }
  const current = storedServiceToken(route);
  if (!input.serviceToken) {
    if (current) return { data: {}, cleared: false };
    throw new EdgeAuthError(400, "invalid_request", "Paste the Access service token's Client ID and Client Secret.");
  }
  const token = { clientId: input.serviceToken.clientId.trim(), clientSecret: input.serviceToken.clientSecret.trim() };
  if (!HEADER_VALUE.test(token.clientId) || !HEADER_VALUE.test(token.clientSecret)) {
    throw new EdgeAuthError(400, "invalid_request", "The Client ID and Client Secret must be pasted exactly as Cloudflare shows them, with no spaces.");
  }
  if (current && sameToken(current, token)) return { data: {}, cleared: false };
  const secret = encryptSecret(JSON.stringify(token));
  return {
    data: {
      edgeAuth: EdgeAuth.serviceToken,
      edgeTokenCiphertext: new Uint8Array(secret.ciphertext),
      edgeTokenIv: new Uint8Array(secret.iv),
      edgeTokenAuthTag: new Uint8Array(secret.authTag),
      // The version never goes back, even across Access being turned off, so a phone never mistakes a new token for one it has.
      edgeTokenVersion: route.edgeTokenVersion + 1,
      edgeTokenRotatedAt: current ? now : null,
    },
    cleared: false,
  };
}

/** The tokens phones need for these routes: every protected route among them whose token can be read. */
export function edgeCredentials(routes: readonly (Pick<ConnectionEndpoint, "id"> & EdgeColumns)[]): EdgeCredential[] {
  return routes.flatMap((route) => {
    const token = storedServiceToken(route);
    return token ? [{ endpointId: route.id, version: route.edgeTokenVersion, ...token }] : [];
  });
}

/** Records that a device was handed these tokens, writing only where its version changed. */
export async function recordDelivered(deviceId: string, credentials: readonly EdgeCredential[]): Promise<void> {
  if (!credentials.length) return;
  const held = await prisma().deviceEdgeToken.findMany({ where: { deviceId, endpointId: { in: credentials.map((item) => item.endpointId) } } });
  const now = new Date();
  for (const credential of credentials) {
    if (held.some((row) => row.endpointId === credential.endpointId && row.version === credential.version)) continue;
    await prisma().deviceEdgeToken.upsert({
      where: { deviceId_endpointId: { deviceId, endpointId: credential.endpointId } },
      create: { deviceId, endpointId: credential.endpointId, version: credential.version, fetchedAt: now },
      update: { version: credential.version, fetchedAt: now },
    });
  }
}

/** Enough of a Client ID to match it against the Cloudflare dashboard, without showing it whole. */
export function clientIdHint(clientId: string): string {
  const id = clientId.replace(/\.access$/, "");
  return `…${id.slice(-6)}${clientId.endsWith(".access") ? ".access" : ""}`;
}

export type EdgeAccess = {
  endpointId: string;
  version: number;
  clientIdHint: string | null;
  rotatedAt: string | null;
  devices: { total: number; current: number; behind: { id: string; displayName: string; lastSeenAt: string | null }[] };
};

/** Each protected route's token and how many active devices have its current version. */
export async function edgeAccessList(now = new Date()): Promise<EdgeAccess[]> {
  const routes = await prisma().connectionEndpoint.findMany({ where: { householdId: "default", edgeAuth: EdgeAuth.serviceToken }, orderBy: { createdAt: "asc" } });
  if (!routes.length) return [];
  const devices = await prisma().pairedDevice.findMany({
    where: { revokedAt: null, lastSeenAt: { gte: new Date(now.getTime() - ACTIVE_DEVICE_WINDOW_MS) } },
    include: { edgeTokens: true },
    orderBy: { displayName: "asc" },
  });
  return routes.map((route) => {
    const token = storedServiceToken(route);
    const behind = devices.filter((device) => !device.edgeTokens.some((row) => row.endpointId === route.id && row.version >= route.edgeTokenVersion));
    return {
      endpointId: route.id,
      version: route.edgeTokenVersion,
      clientIdHint: token ? clientIdHint(token.clientId) : null,
      rotatedAt: route.edgeTokenRotatedAt?.toISOString() ?? null,
      devices: {
        total: devices.length,
        current: devices.length - behind.length,
        behind: behind.map((device) => ({ id: device.id, displayName: device.displayName, lastSeenAt: device.lastSeenAt?.toISOString() ?? null })),
      },
    };
  });
}
