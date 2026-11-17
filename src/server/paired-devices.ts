import type { Prisma } from "@prisma/client";
import { CLIENT_TYPES } from "@/lib/client-type";
import { z } from "zod";
import { isAdministrator, removeDevice, revokeDevice } from "./connection";
import { prisma } from "./db";
import { isFullApp, isValidScope } from "./device-scope";
import { ApiError } from "./http";

type Viewer = Parameters<typeof isAdministrator>[0];

/**
 * Which paired devices a caller may see and manage: an administrator sees them all; a paired device
 * sees itself and the devices it paired: a phone's Watches, and the phones and agents its invites paired. Anyone else sees none.
 */
function visibleDevices(session: Viewer): Prisma.PairedDeviceWhereInput | null {
  if (isAdministrator(session)) return {};
  if (session.deviceId) return { OR: [{ id: session.deviceId }, { parentDeviceId: session.deviceId }] };
  return null;
}

/** What a listed device carries, with the sessions still able to call or renew: a live bearer or refresh token. */
function deviceInclude(now = new Date()) {
  return {
    account: { select: { username: true, displayName: true } },
    edgeTokens: { select: { endpointId: true, version: true } },
    pushRegistration: { select: { deviceId: true } },
    pairings: { include: { endpoint: true }, take: 1 },
    sessions: {
      where: { revokedAt: null, OR: [{ expiresAt: { gt: now } }, { refreshExpiresAt: { gt: now } }] },
      select: { id: true, username: true, expiresAt: true, refreshExpiresAt: true, createdAt: true },
    },
  } satisfies Prisma.PairedDeviceInclude;
}

type Listed = Prisma.PairedDeviceGetPayload<{ include: ReturnType<typeof deviceInclude> }>;

function publicPairedDevice(device: Listed) {
  const route = device.pairings[0]?.endpoint ?? null;
  return {
    id: device.id,
    displayName: device.displayName,
    clientType: device.clientType,
    scope: device.scope,
    actsAs: device.account ? { username: device.account.username, displayName: device.account.displayName } : null,
    parentDeviceId: device.parentDeviceId,
    enrolledAt: device.createdAt.toISOString(),
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    pairedVia: route ? { endpointId: route.id, url: route.url, transport: route.transport } : null,
    edgeTokens: device.edgeTokens,
    // Whether the app gets phone alerts; only the app itself registers, so other devices leave it out.
    ...(isFullApp(device) ? { alerts: Boolean(device.pushRegistration) } : {}),
    // A paired device's sign-in ends when its refresh token does, not its one-hour bearer.
    sessions: device.sessions.map((session) => ({
      id: session.id,
      username: session.username,
      expiresAt: (session.refreshExpiresAt ?? session.expiresAt).toISOString(),
      createdAt: session.createdAt.toISOString(),
    })),
  };
}

const Filter = z.object({
  clientType: z.array(z.enum(CLIENT_TYPES)),
  status: z.enum(["active", "revoked"]).optional(),
});

function deviceNotFound() {
  return new ApiError(404, "not_found", "Paired device not found.");
}

function requireVisible(session: Viewer) {
  const visible = visibleDevices(session);
  if (!visible) throw new ApiError(403, "administrator_required", "A FamilyFi administrator or a paired device is required.");
  return visible;
}

/** Paired devices the caller may see, narrowed by the query's `clientType` (repeatable) and `status`, as sent. */
export async function listPairedDevices(session: Viewer, query: { clientType: string[]; status?: string }) {
  const visible = requireVisible(session);
  const filter = Filter.safeParse(query);
  if (!filter.success) throw new ApiError(400, "invalid_request", "clientType must be app, app-watch, app-controls, me or agent, and status active or revoked.");
  const { status } = filter.data;
  const clientTypes = filter.data.clientType;
  const devices = await prisma().pairedDevice.findMany({
    where: {
      AND: [
        visible,
        clientTypes.length ? { clientType: { in: clientTypes } } : {},
        status === "active" ? { revokedAt: null } : status === "revoked" ? { revokedAt: { not: null } } : {},
      ],
    },
    orderBy: { lastSeenAt: "desc" },
    include: deviceInclude(),
  });
  return devices.map(publicPairedDevice);
}

export async function getPairedDevice(session: Viewer, id: string) {
  const visible = requireVisible(session);
  const device = await prisma().pairedDevice.findFirst({ where: { AND: [visible, { id }] }, include: deviceInclude() });
  if (!device) throw deviceNotFound();
  return publicPairedDevice(device);
}

/**
 * Rename a paired device, or change an agent's scope between `agent:full` and `agent:readOnly`. No
 * other client type changes scope: each holds only its own from the moment it joins.
 */
export async function updatePairedDevice(id: string, input: { displayName?: string; scope?: string }) {
  const device = await prisma().pairedDevice.findUnique({ where: { id } });
  if (!device) throw deviceNotFound();
  const scope = input.scope && input.scope !== device.scope ? (device.clientType === "agent" && isValidScope("agent", input.scope) ? input.scope : null) : undefined;
  if (scope === null) throw new ApiError(400, "invalid_scope", `A device of client type ${device.clientType} cannot hold the ${input.scope} scope.`);
  await prisma().pairedDevice.update({ where: { id }, data: { displayName: input.displayName, ...(scope ? { scope } : {}) } });
  const updated = await prisma().pairedDevice.findUniqueOrThrow({ where: { id }, include: deviceInclude() });
  return publicPairedDevice(updated);
}

/**
 * Revoke a paired device: an administrator, the device itself, or the phone that vouched for it.
 * Revoking a device revokes everything paired from it: a phone's Watches, and the phones and agents its invites paired, in turn.
 * `remove` (administrator only) deletes the record.
 */
export async function revokePairedDevice(session: Viewer, id: string, remove: boolean) {
  const administrator = isAdministrator(session);
  const device = await prisma().pairedDevice.findUnique({ where: { id }, select: { parentDeviceId: true } });
  const own = Boolean(session.deviceId) && session.deviceId === id;
  const parent = Boolean(session.deviceId) && device?.parentDeviceId === session.deviceId;
  if (!administrator && !own && !parent) throw new ApiError(403, "administrator_required", "An administrator, this paired device or its phone is required.");
  if (remove) {
    if (!administrator) throw new ApiError(403, "administrator_required", "Only an administrator can remove a device record.");
    if (!(await removeDevice(id))) throw deviceNotFound();
    return;
  }
  const revoked = await prisma().$transaction((db) => revokeDevice(id, db as never));
  if (!revoked) throw deviceNotFound();
}
