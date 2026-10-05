import { ConnectionTrustMode, DeviceScope, PairedDeviceClient, SessionKind, type Account, type Pairing } from "@prisma/client";
import { bearerSessionData, isAdministratorAccount, toPublicSession } from "./auth";
import { ensureConnectionIdentity, instanceFingerprint, publicEndpoint, removeDevice, signedEndpointManifest } from "./connection";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";
import { isValidScope } from "./device-scope";
import { storedServiceToken } from "./edge-auth";
import { encodePairingCode, PAIRING_CODE_VERSION } from "./pairing-code";

/**
 * How every paired device joins: an invite, then a claim that signs the device in. Pairing is the
 * authentication: the invite names the account the device acts as, and the claim returns its bearer
 * and refresh token; nobody types a password and no device credential exists.
 *
 * - A phone's invite is made by an administrator over a published route; its code carries that route,
 *   its pin or Cloudflare Access token. The phone acts as the adult the administrator chose.
 * - An agent's invite is made by an administrator on the home network; its code carries the household's
 *   home network address, or the address it was made at when none is set, and nothing for remote
 *   access. The agent acts as whoever made it.
 * - A Watch is invited and claimed at once by its phone, its parent; it acts as the phone's account.
 */

const PHONE_INVITE_TTL_MS = 5 * 60 * 1000;
/** Long enough to paste a prompt into an agent and let it read the guide first. */
const AGENT_INVITE_TTL_MS = 15 * 60 * 1000;

type Db = Parameters<Parameters<ReturnType<typeof prisma>["$transaction"]>[0]>[0];

export type InviteStatus = "pending" | "claimed" | "expired";

export function inviteStatus(invite: { claimedAt: Date | null; expiresAt: Date }, now = new Date()): InviteStatus {
  if (invite.claimedAt) return "claimed";
  return invite.expiresAt <= now ? "expired" : "pending";
}

/** A phone invite, over the published route the phone pairs through. */
export async function invitePhone(input: { endpointId: string; displayName: string; accountId: string; createdByAccountId: string; replacesDeviceId?: string | null }) {
  const token = randomToken();
  const invite = await prisma().pairing.create({
    data: {
      client: PairedDeviceClient.phone,
      scope: DeviceScope.full,
      endpointId: input.endpointId,
      displayName: input.displayName,
      accountId: input.accountId,
      createdByAccountId: input.createdByAccountId,
      replacesDeviceId: input.replacesDeviceId ?? null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + PHONE_INVITE_TTL_MS),
    },
    include: { endpoint: true },
  });
  const household = await ensureConnectionIdentity();
  const endpoint = invite.endpoint!;
  // A route behind Cloudflare Access is unreachable without its token, so the code carries it: a phone
  // pairs over the protected route itself. The token only gets past Cloudflare; joining still needs the single-use code.
  const edgeToken = storedServiceToken(endpoint);
  const code = encodePairingCode({
    version: PAIRING_CODE_VERSION,
    url: endpoint.url,
    code: `${invite.id}.${token}`,
    fingerprint: instanceFingerprint(household.instancePublicKey!),
    ...(endpoint.trustMode === ConnectionTrustMode.pinned && endpoint.spkiSha256 ? { pin: endpoint.spkiSha256 } : {}),
    ...(edgeToken ? { access: edgeToken } : {}),
  });
  return { invite, code };
}

/**
 * An agent invite. It has no route: the code carries `url`, the address the adult made it from, which
 * is on the home network because browser sign-in is. It never carries a pin or an Access token.
 */
export async function inviteAgent(input: { url: string; displayName: string; scope: DeviceScope; createdByAccountId: string }) {
  if (!isValidScope(PairedDeviceClient.agent, input.scope)) throw new Error(`An agent cannot hold the ${input.scope} scope.`);
  const token = randomToken();
  const invite = await prisma().pairing.create({
    data: {
      client: PairedDeviceClient.agent,
      scope: input.scope,
      displayName: input.displayName,
      accountId: input.createdByAccountId,
      createdByAccountId: input.createdByAccountId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + AGENT_INVITE_TTL_MS),
    },
  });
  const household = await ensureConnectionIdentity();
  const code = encodePairingCode({ version: PAIRING_CODE_VERSION, url: input.url, code: `${invite.id}.${token}`, fingerprint: instanceFingerprint(household.instancePublicKey!) });
  return { invite, code };
}

type Joined = { invite: Pairing; device: { id: string; displayName: string; client: PairedDeviceClient; scope: DeviceScope }; account: Account; bearer: ReturnType<typeof bearerSessionData> };

/** Creates the device and signs it in, inside the caller's transaction. */
async function join(db: Db, input: {
  invite: Pairing;
  account: Account;
  displayName: string;
  clientId?: string | null;
  userAgent?: string | null;
  now: Date;
}): Promise<Omit<Joined, "invite" | "account">> {
  const { invite, account, now } = input;
  if (!invite.scope || !isValidScope(invite.client, invite.scope)) throw new Error(`A ${invite.client} cannot hold the ${invite.scope} scope.`);
  // A re-paired phone or a re-enrolled Watch retires the record it replaces, so it is never listed twice.
  const replaces = invite.replacesDeviceId;
  if (input.clientId) {
    const previous = await db.pairedDevice.findUnique({ where: { clientId: input.clientId } });
    if (previous) {
      await db.session.updateMany({ where: { deviceId: previous.id, revokedAt: null }, data: { revokedAt: now } });
      await db.pairedDevice.update({ where: { id: previous.id }, data: { revokedAt: now, clientId: null } });
    }
  }
  const device = await db.pairedDevice.create({
    data: {
      displayName: input.displayName,
      client: invite.client,
      scope: invite.scope,
      clientId: input.clientId ?? null,
      accountId: account.id,
      parentDeviceId: invite.parentDeviceId,
      lastSeenAt: now,
    },
  });
  await db.pairing.update({ where: { id: invite.id }, data: { claimedDeviceId: device.id } });
  if (replaces) {
    // The new phone keeps the old one's companions: its Watch is still its to manage.
    await db.pairedDevice.updateMany({ where: { parentDeviceId: replaces }, data: { parentDeviceId: device.id } });
    await removeDevice(replaces, db, now);
  }
  const bearer = bearerSessionData(now);
  await db.session.create({
    data: { ...bearer.data, kind: SessionKind.bearer, accountId: account.id, username: account.username, deviceId: device.id, userAgent: input.userAgent ?? undefined },
  });
  return { device, bearer };
}

/** What a claim answers, the same for every client. Phones and Watches, which may work away from home, also get their manifest. */
export async function claimResponse(joined: Joined, endpoint: Parameters<typeof publicEndpoint>[0] | null) {
  const { invite, device, account, bearer } = joined;
  const remote = invite.client === PairedDeviceClient.phone || invite.client === PairedDeviceClient.watch;
  return {
    device: { id: device.id, displayName: device.displayName, client: device.client, scope: device.scope },
    session: toPublicSession({ username: account.username, expiresAt: bearer.expiresAt, account }),
    token: bearer.token,
    tokenType: "Bearer" as const,
    refreshToken: bearer.refreshToken,
    refreshExpiresAt: bearer.refreshExpiresAt.toISOString(),
    ...(remote
      ? { connection: { ...(endpoint ? { endpoint: publicEndpoint(endpoint) } : {}), manifest: await signedEndpointManifest({ deviceId: device.id }) } }
      : {}),
  };
}

/** Claims an invite with its single-use token. A Watch invite is never claimable here: its phone claimed it already. */
export async function claimInvite(input: { id: string; token: string; displayName: string; userAgent?: string | null }) {
  const invite = await prisma().pairing.findUnique({ where: { id: input.id }, include: { endpoint: true, account: true } });
  if (!invite || invite.client === PairedDeviceClient.watch || invite.claimedAt || invite.expiresAt <= new Date() || !safeEqual(invite.tokenHash, sha256(input.token))) return null;
  if (invite.client === PairedDeviceClient.phone && !invite.endpoint) return null;
  const account = invite.account;
  // Only administrators have paired devices: an invite for an adult who has since lost that is void.
  if (!account || !isAdministratorAccount(account)) return null;
  const now = new Date();
  const joined = await prisma().$transaction(async (db) => {
    const claimed = await db.pairing.updateMany({ where: { id: invite.id, claimedAt: null, expiresAt: { gt: now } }, data: { claimedAt: now } });
    if (claimed.count !== 1) return null;
    return join(db, { invite, account, displayName: input.displayName, userAgent: input.userAgent, now });
  });
  if (!joined) return null;
  return claimResponse({ invite, account, ...joined }, invite.endpoint);
}

/**
 * A phone invites its Watch and claims it in one transaction. The Watch makes no network call to
 * join: the phone hands it the tokens and manifest. Re-enrolling the same `clientId` retires the old Watch.
 */
export async function inviteAndClaimWatch(input: { parentDeviceId: string; account: Account; clientId: string; displayName: string; userAgent?: string | null }) {
  const now = new Date();
  const joined = await prisma().$transaction(async (db) => {
    const invite = await db.pairing.create({
      data: {
        client: PairedDeviceClient.watch,
        scope: DeviceScope.rulesOnly,
        displayName: input.displayName,
        accountId: input.account.id,
        createdByAccountId: input.account.id,
        parentDeviceId: input.parentDeviceId,
        tokenHash: sha256(randomToken()),
        expiresAt: now,
        claimedAt: now,
      },
    });
    return { invite, ...(await join(db, { invite, account: input.account, displayName: input.displayName, clientId: input.clientId, userAgent: input.userAgent, now })) };
  });
  return { invite: joined.invite, claim: await claimResponse({ ...joined, account: input.account }, null) };
}

/** Ends a pending invite early. Expiring it, rather than deleting it, keeps the claim path's single check. */
export async function cancelInvite(id: string): Promise<boolean> {
  const now = new Date();
  const cancelled = await prisma().pairing.updateMany({ where: { id, claimedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  return cancelled.count === 1;
}
