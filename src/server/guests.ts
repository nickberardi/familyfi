import type { Household } from "@prisma/client";
import { prisma } from "./db";
import { normalizeMac } from "./mac";
import { clientForHousehold, connectionIdentity } from "./unifi/connection";
import { mapClientsToZones } from "./unifi/mapping";
import { networkInScope } from "./unifi/scope";
import { loadNetworkClientIds, loadNetworkDetails } from "./unifi/spike";
import type { UnifiClient } from "./unifi/client";
import type { ClientOverview, HotspotVoucher, WifiBroadcast } from "./unifi/types";

export class GuestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type Context = { household: Household; client: UnifiClient; siteId: string; identity: string };

async function context(): Promise<Context> {
  const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
  if (!household.unifiSiteId || !household.unifiKeyLastFour) {
    throw new GuestError(409, "unifi_unconfigured", "Configure UniFi before issuing guest access.");
  }
  return { household, client: clientForHousehold(household), siteId: household.unifiSiteId, identity: connectionIdentity(household) };
}

function guestZone(name: string): boolean {
  return /^(guest|hotspot)(\s|$)/i.test(name.trim());
}

function portalNetworkIds(broadcasts: WifiBroadcast[]): { ids: Set<string>; enabledIds: Set<string>; unknown: boolean } {
  const ids = new Set<string>();
  const enabledIds = new Set<string>();
  let unknown = false;
  for (const broadcast of broadcasts) {
    if (broadcast.hotspotConfiguration?.type !== "CAPTIVE_PORTAL") continue;
    if (broadcast.network?.type !== "SPECIFIC" || !broadcast.network.networkId) unknown = true;
    else {
      ids.add(broadcast.network.networkId);
      if (broadcast.enabled) enabledIds.add(broadcast.network.networkId);
    }
  }
  return { ids, enabledIds, unknown };
}

async function inventory(ctx: Context) {
  const [networks, zones, clients, broadcastResult] = await Promise.all([
    loadNetworkDetails(ctx.client, ctx.siteId), ctx.client.listZones(ctx.siteId),
    ctx.client.listClients(ctx.siteId), ctx.client.listWifiBroadcasts(ctx.siteId).then(
      (broadcasts) => ({ known: true, broadcasts }),
      () => ({ known: false, broadcasts: [] as WifiBroadcast[] }),
    ),
  ]);
  const networkClientIds = await loadNetworkClientIds(ctx.client, ctx.siteId, networks);
  const mappings = mapClientsToZones({ clients, networks, zones, networkClientIds });
  const mappedByClient = new Map(mappings.map((mapped) => [mapped.clientId, mapped]));
  const scope = { manageAllNetworks: ctx.household.unifiManageAllNetworks, managedNetworkIds: ctx.household.unifiManagedNetworkIds };
  const portal = portalNetworkIds(broadcastResult.broadcasts);
  const guestNetworks = networks.filter((network) => {
    const zone = zones.find((item) => item.id === network.zoneId || item.networkIds.includes(network.id));
    return portal.ids.has(network.id) || Boolean(zone && guestZone(zone.name));
  });
  const guestNetworkIds = new Set(guestNetworks.map((network) => network.id));
  const known = new Set((await prisma().device.findMany({ select: { mac: true } })).map((device) => device.mac));
  const eligibleClients = clients.flatMap((client) => {
    const mapped = mappedByClient.get(client.id);
    if (!mapped?.networkId || mapped.method !== "network-reference" || networkInScope(scope, mapped.networkId)) return [];
    if (client.access?.type !== "GUEST" || typeof client.access.authorized !== "boolean" || !mapped.macAddress || known.has(mapped.macAddress)) return [];
    return [{
      id: client.id,
      name: client.name,
      mac: mapped.macAddress,
      networkId: mapped.networkId,
      authorized: client.access.authorized === true,
    }];
  });
  for (const client of eligibleClients) guestNetworkIds.add(client.networkId);
  const vouchersEnabled = broadcastResult.known && portal.enabledIds.size > 0 && !portal.unknown &&
    [...portal.ids].every((id) => networks.some((network) => network.id === id) && !networkInScope(scope, id));
  const reason = guestNetworkIds.size === 0 ? "no_guest_network" :
    [...guestNetworkIds].every((id) => networkInScope(scope, id)) ? "managed_overlap" : null;
  return { clients, eligibleClients, vouchersEnabled, reason };
}

function passState(row: { status: string; authorizedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; clientId: string }, live?: ClientOverview) {
  if (row.status === "uncertain" || row.status === "revoking") return "unknown";
  if (row.revokedAt) return "revoked";
  if (!row.authorizedAt || !row.expiresAt) return "unknown";
  if (!live) return "unknown";
  const authorization = live.access?.authorization;
  if (live.access?.authorized === true && authorization?.authorizationMethod === "API" &&
    Date.parse(authorization.authorizedAt) === row.authorizedAt.getTime()) {
    const liveExpiry = Date.parse(authorization.expiresAt);
    return Number.isFinite(liveExpiry) ? (liveExpiry <= Date.now() ? "expired" : "active") : "unknown";
  }
  return live.access?.authorized === false && row.expiresAt <= new Date() ? "expired" : "unknown";
}

function publicPass(row: {
  id: string; clientId: string; mac: string; networkId: string; status: string;
  authorizedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null;
}, live?: ClientOverview) {
  return {
    id: row.id, clientId: row.clientId, mac: row.mac, networkId: row.networkId,
    status: passState(row, live), authorizedAt: row.authorizedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function publicVoucher(row: {
  id: string; unifiVoucherId: string | null; timeLimitMinutes: number; status: string;
}, live?: HotspotVoucher) {
  const status = row.status === "uncertain" || row.status === "revoking" ? "unknown" : row.status === "revoked" ? "revoked" :
    !live ? "unknown" : live.expired ? "expired" : live.activatedAt ? "active" : "unused";
  return {
    id: row.id, code: live?.code ?? null, timeLimitMinutes: row.timeLimitMinutes,
    status, activatedAt: live?.activatedAt ?? null, expiresAt: live?.expiresAt ?? null,
  };
}

export async function listGuests() {
  let ctx: Context;
  try { ctx = await context(); }
  catch (error) {
    if (error instanceof GuestError && error.code === "unifi_unconfigured") {
      const household = await prisma().household.findUnique({ where: { id: "default" } });
      if (household?.unifiSiteId) {
        const where = { connectionIdentity: connectionIdentity(household), siteId: household.unifiSiteId };
        const [passes, vouchers] = await Promise.all([
          prisma().guestPass.findMany({ where, orderBy: { createdAt: "desc" } }),
          prisma().guestVoucher.findMany({ where, orderBy: { createdAt: "desc" } }),
        ]);
        return { status: "unconfigured", reason: "unifi_unconfigured", voucherAvailable: false, clients: [],
          passes: passes.map((row) => publicPass(row)), vouchers: vouchers.map((row) => publicVoucher(row)) };
      }
      return { status: "unconfigured", reason: "unifi_unconfigured", voucherAvailable: false, clients: [], passes: [], vouchers: [] };
    }
    throw error;
  }
  const where = { connectionIdentity: ctx.identity, siteId: ctx.siteId };
  const [passes, vouchers] = await Promise.all([
    prisma().guestPass.findMany({ where, orderBy: { createdAt: "desc" } }),
    prisma().guestVoucher.findMany({ where, orderBy: { createdAt: "desc" } }),
  ]);
  try {
    const [live, liveVouchers] = await Promise.all([
      inventory(ctx), ctx.client.listVouchers(ctx.siteId).catch(() => null),
    ]);
    const detailed = await Promise.all(passes.map(async (row) => {
      if (row.revokedAt || !row.expiresAt) return null;
      return ctx.client.getClient(ctx.siteId, row.clientId).catch(() => null);
    }));
    const voucherById = new Map((liveVouchers ?? []).map((voucher) => [voucher.id, voucher]));
    return {
      status: "ready", reason: live.reason, voucherAvailable: live.vouchersEnabled && liveVouchers !== null,
      clients: live.eligibleClients,
      passes: passes.map((row, index) => publicPass(row, detailed[index] ?? undefined)),
      vouchers: vouchers.map((row) => publicVoucher(row, row.unifiVoucherId ? voucherById.get(row.unifiVoucherId) : undefined)),
    };
  } catch {
    return {
      status: "unavailable", reason: "unifi_unavailable", voucherAvailable: false, clients: [],
      passes: passes.map((row) => publicPass(row)),
      vouchers: vouchers.map((row) => publicVoucher(row)),
    };
  }
}

export async function createGuestPass(clientId: string, timeLimitMinutes: number) {
  const ctx = await context();
  let live: Awaited<ReturnType<typeof inventory>>;
  try { live = await inventory(ctx); }
  catch { throw new GuestError(502, "unifi_unavailable", "Could not check guest network eligibility."); }
  const candidate = live.eligibleClients.find((client) => client.id === clientId);
  if (!candidate) throw new GuestError(409, "guest_ineligible", "This device is not an eligible visitor on an excluded guest network.");
  if (candidate.authorized) throw new GuestError(409, "already_authorized", "This visitor already has guest access.");
  const row = await prisma().$transaction(async (tx) => {
    // Serialize claims for one client before the external write, so parallel requests cannot both issue a pass.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`${ctx.identity}:${ctx.siteId}:${clientId}`})::bigint)`;
    const previous = await tx.guestPass.findFirst({
      where: { connectionIdentity: ctx.identity, siteId: ctx.siteId, clientId, OR: [
        { status: { in: ["pending", "uncertain", "revoking"] } },
        { status: "active", revokedAt: null, expiresAt: { gt: new Date() } },
      ] },
    });
    if (previous) throw new GuestError(409, "outcome_unknown", "A previous guest action has an uncertain outcome.");
    return tx.guestPass.create({
      data: { connectionIdentity: ctx.identity, siteId: ctx.siteId, clientId, mac: normalizeMac(candidate.mac), networkId: candidate.networkId },
    });
  });
  try {
    const result = await ctx.client.authorizeGuest(ctx.siteId, clientId, timeLimitMinutes);
    if (!result.grantedAuthorization || result.grantedAuthorization.authorizationMethod !== "API") throw new Error("UniFi did not confirm guest authorization.");
    const updated = await prisma().guestPass.update({ where: { id: row.id }, data: {
      status: "active", authorizedAt: new Date(result.grantedAuthorization.authorizedAt),
      expiresAt: new Date(result.grantedAuthorization.expiresAt),
    } });
    return publicPass(updated, {
      id: clientId, name: "", type: "WIRELESS",
      access: { type: "GUEST", authorized: true, authorization: result.grantedAuthorization },
    });
  } catch {
    await prisma().guestPass.update({ where: { id: row.id }, data: { status: "uncertain" } });
    throw new GuestError(502, "outcome_unknown", "UniFi did not confirm guest access. Check the guest list before trying again.");
  }
}

export async function revokeGuestPass(id: string) {
  const ctx = await context();
  const row = await prisma().guestPass.findFirst({ where: { id, connectionIdentity: ctx.identity, siteId: ctx.siteId } });
  if (!row) throw new GuestError(404, "not_found", "Guest pass not found.");
  if (row.revokedAt) return publicPass(row);
  if (!row.authorizedAt || row.status !== "active") throw new GuestError(409, "outcome_unknown", "Guest authorization is not confirmed.");
  let live: Awaited<ReturnType<typeof inventory>>;
  try { live = await inventory(ctx); }
  catch { throw new GuestError(502, "unifi_unavailable", "Could not confirm the visitor's current network."); }
  const candidate = live.eligibleClients.find((client) => client.id === row.clientId && client.mac === row.mac && client.networkId === row.networkId);
  let client: ClientOverview;
  try { client = await ctx.client.getClient(ctx.siteId, row.clientId); }
  catch { throw new GuestError(502, "unifi_unavailable", "Could not confirm the visitor's current authorization."); }
  if (!candidate || passState(row, client) !== "active") {
    throw new GuestError(409, "guest_changed", "The visitor's current authorization no longer matches this pass.");
  }
  const claimed = await prisma().guestPass.updateMany({ where: { id, status: "active", revokedAt: null }, data: { status: "revoking" } });
  if (claimed.count !== 1) throw new GuestError(409, "outcome_unknown", "Guest revocation is already in progress.");
  try {
    const result = await ctx.client.unauthorizeGuest(ctx.siteId, row.clientId);
    if (result?.action !== "UNAUTHORIZE_GUEST_ACCESS" || result.revokedAuthorization?.authorizationMethod !== "API" ||
      Date.parse(result.revokedAuthorization.authorizedAt) !== row.authorizedAt.getTime()) {
      throw new Error("UniFi did not confirm revocation of this pass.");
    }
    const updated = await prisma().guestPass.update({ where: { id }, data: { status: "revoked", revokedAt: new Date() } });
    return publicPass(updated);
  } catch {
    await prisma().guestPass.update({ where: { id }, data: { status: "uncertain" } });
    throw new GuestError(502, "outcome_unknown", "UniFi did not confirm revocation. Check the guest list.");
  }
}

export async function createGuestVoucher(timeLimitMinutes: number) {
  const ctx = await context();
  let live: Awaited<ReturnType<typeof inventory>>;
  try { live = await inventory(ctx); }
  catch { throw new GuestError(502, "unifi_unavailable", "Could not check hotspot networks."); }
  if (!live.vouchersEnabled) throw new GuestError(409, "voucher_unavailable", "A separate captive-portal guest network is required for vouchers.");
  const row = await prisma().guestVoucher.create({
    data: { connectionIdentity: ctx.identity, siteId: ctx.siteId, timeLimitMinutes },
  });
  try {
    const voucher = await ctx.client.createVoucher(ctx.siteId, timeLimitMinutes);
    const updated = await prisma().guestVoucher.update({ where: { id: row.id }, data: { status: "active", unifiVoucherId: voucher.id } });
    return publicVoucher(updated, voucher);
  } catch {
    await prisma().guestVoucher.update({ where: { id: row.id }, data: { status: "uncertain" } });
    throw new GuestError(502, "outcome_unknown", "UniFi did not confirm voucher creation. Check the voucher list.");
  }
}

export async function revokeGuestVoucher(id: string) {
  const ctx = await context();
  const row = await prisma().guestVoucher.findFirst({ where: { id, connectionIdentity: ctx.identity, siteId: ctx.siteId } });
  if (!row) throw new GuestError(404, "not_found", "Voucher not found.");
  if (row.status === "revoked") return publicVoucher(row);
  if (!row.unifiVoucherId || row.status !== "active") throw new GuestError(409, "outcome_unknown", "Voucher state is not confirmed for revocation.");
  const claimed = await prisma().guestVoucher.updateMany({ where: { id, status: "active" }, data: { status: "revoking" } });
  if (claimed.count !== 1) throw new GuestError(409, "outcome_unknown", "Voucher revocation is already in progress.");
  try {
    const deleted = await ctx.client.deleteVoucher(ctx.siteId, row.unifiVoucherId);
    if (deleted !== 1) throw new Error("UniFi did not confirm voucher deletion.");
    const updated = await prisma().guestVoucher.update({ where: { id }, data: { status: "revoked" } });
    return publicVoucher(updated);
  } catch (error) {
    if (error instanceof GuestError) throw error;
    await prisma().guestVoucher.update({ where: { id }, data: { status: "uncertain" } });
    throw new GuestError(502, "outcome_unknown", "UniFi did not confirm voucher revocation. Check the voucher list.");
  }
}
