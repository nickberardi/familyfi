import { type Prisma } from "@prisma/client";
import { isAdministrator } from "./connection";

type Viewer = Parameters<typeof isAdministrator>[0];

/**
 * Which paired devices a caller may see and manage: an administrator sees them all; a paired device
 * sees itself and the companions it vouched for, such as a phone's Watch. Anyone else sees none.
 */
export function visibleDevices(session: Viewer): Prisma.PairedDeviceWhereInput | null {
  if (isAdministrator(session)) return {};
  if (session.deviceId) return { OR: [{ id: session.deviceId }, { parentDeviceId: session.deviceId }] };
  return null;
}

/** What a listed device carries, with the sessions still able to call or renew: a live bearer or refresh token. */
export function deviceInclude(now = new Date()) {
  return {
    account: { select: { username: true, displayName: true } },
    edgeTokens: { select: { endpointId: true, version: true } },
    pairings: { include: { endpoint: true }, take: 1 },
    sessions: {
      where: { revokedAt: null, OR: [{ expiresAt: { gt: now } }, { refreshExpiresAt: { gt: now } }] },
      select: { id: true, username: true, expiresAt: true, refreshExpiresAt: true, createdAt: true },
    },
  } satisfies Prisma.PairedDeviceInclude;
}

type Listed = Prisma.PairedDeviceGetPayload<{ include: ReturnType<typeof deviceInclude> }>;

export function publicPairedDevice(device: Listed) {
  const route = device.pairings[0]?.endpoint ?? null;
  return {
    id: device.id,
    displayName: device.displayName,
    client: device.client,
    scope: device.scope,
    actsAs: device.account ? { username: device.account.username, displayName: device.account.displayName } : null,
    parentDeviceId: device.parentDeviceId,
    enrolledAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    pairedVia: route ? { endpointId: route.id, url: route.url, transport: route.transport } : null,
    edgeTokens: device.edgeTokens,
    // A paired device's sign-in ends when its refresh token does, not its one-hour bearer.
    sessions: device.sessions.map((session) => ({
      id: session.id,
      username: session.username,
      client: device.client,
      expiresAt: (session.refreshExpiresAt ?? session.expiresAt).toISOString(),
      createdAt: session.createdAt.toISOString(),
    })),
  };
}
