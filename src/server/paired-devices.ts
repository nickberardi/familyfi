import type { Prisma } from "@prisma/client";
import { CLIENT_TYPES, legacyClient, scopeWord } from "@/lib/client-type";
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
    client: legacyClient(device.clientType),
    clientType: device.clientType,
    scope: scopeWord(device.scope),
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
      client: legacyClient(device.clientType),
      expiresAt: (session.refreshExpiresAt ?? session.expiresAt).toISOString(),
      createdAt: session.createdAt.toISOString(),
    })),
  };
}

const Filter = z.object({
  client: z.array(z.enum(["app", "phone", "watch", "agent", ...CLIENT_TYPES])),
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

/** Paired devices the caller may see, narrowed by the query's `client` (repeatable) and `status`, as sent. */
export async function listPairedDevices(session: Viewer, query: { client: string[]; status?: string }) {
  const visible = requireVisible(session);
  const filter = Filter.safeParse(query);
  if (!filter.success) throw new ApiError(400, "invalid_request", "client must be a client type (app, app-watch, app-controls, me or agent) or watch, and status active or revoked.");
  const { status } = filter.data;
  // The older words: `app` is the app and its Siri and shortcuts, `watch` its Watch, and `phone` the deprecated name for `app`.
  const clientTypes = [...new Set(filter.data.client.flatMap((kind) => (kind === "phone" || kind === "app" ? ["app", "app-controls"] : kind === "watch" ? ["app-watch"] : [kind])))];
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
 * Rename a paired device, or change an agent's scope. No other kind changes scope: an app is `full` or
 * its own `rulesOnly` sign-in from the moment it joins, and one must never become the other.
 */
export async function updatePairedDevice(id: string, input: { displayName?: string; scope?: string }) {
  const device = await prisma().pairedDevice.findUnique({ where: { id } });
  if (!device) throw deviceNotFound();
  // An agent's scope may come as its word (`full`), read in the device's own group, or whole (`agent:full`).
  const whole = input.scope === undefined ? undefined : input.scope.includes(":") ? input.scope : `${device.scope.split(":")[0]}:${input.scope}`;
  const scope = whole && whole !== device.scope ? (device.clientType === "agent" && isValidScope("agent", whole) ? whole : null) : undefined;
  if (scope === null) throw new ApiError(400, "invalid_scope", `A ${legacyClient(device.clientType)} cannot hold the ${input.scope} scope.`);
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
