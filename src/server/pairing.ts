import { ConnectionTrustMode, GroupKind, SessionKind, type Account, type Pairing } from "@prisma/client";
import type { ClientScope, ClientType } from "@/lib/client-type";
import { bearerSessionData, isAdministratorAccount, mayPairAs, meSessionUsername, toPublicSession, type SignedInSession } from "./auth";
import { ensureConnectionIdentity, instanceFingerprint, publicEndpoint, removeDevice, signedEndpointManifest } from "./connection";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";
import { isFullApp, isValidScope } from "./device-scope";
import { storedServiceToken } from "./edge-auth";
import { loadHousehold } from "./household";
import { ApiError } from "./http";
import { encodePairingCode, PAIRING_CODE_VERSION } from "./pairing-code";
import { currentHouseholdId } from "./household-context";

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
 * - A child's phone (FamilyFi Me, `me`) is invited by an administrator over a route, as a phone is,
 *   and its code carries the same: route, pin or Cloudflare Access token. It signs in for the family
 *   group the invite names, never as an account, and has no parent device: it belongs to its group,
 *   so re-pairing or revoking the phone that invited it leaves it alone.
 * - FamilyFi Me's Watch (`me-watch`) is invited and claimed at once by its child's phone, its parent,
 *   as an app's Watch is; it signs in for the same family group, never as an account.
 *
 * An invite a paired phone makes names that phone as the new device's parent, as a Watch's does:
 * revoking a phone revokes everything paired from it. No device ever acts as the recovery account.
 */

const PHONE_INVITE_TTL_MS = 5 * 60 * 1000;
/** Long enough to paste a prompt into an agent and let it read the guide first. */
const AGENT_INVITE_TTL_MS = 15 * 60 * 1000;

type Db = Parameters<Parameters<ReturnType<typeof prisma>["$transaction"]>[0]>[0];

export type InviteStatus = "pending" | "claimed" | "expired";

function inviteStatus(invite: { claimedAt: Date | null; expiresAt: Date }, now = new Date()): InviteStatus {
  if (invite.claimedAt) return "claimed";
  return invite.expiresAt <= now ? "expired" : "pending";
}

/**
 * A phone invite, over the published route the phone pairs through: the app's, acting as an account,
 * or a child's (`me`), signing in for a family group.
 */
async function invitePhone(input: { endpointId: string; displayName: string; createdByAccountId: string; parentDeviceId?: string | null; madeByDeviceId?: string | null; replacesDeviceId?: string | null } & ({ clientType: "app"; accountId: string } | { clientType: "me"; groupId: string })) {
  const token = randomToken();
  const clientType = input.clientType;
  const invite = await prisma().pairing.create({
    data: {
      clientType,
      scope: clientType === "me" ? "me:askOnly" : "app:full",
      endpointId: input.endpointId,
      displayName: input.displayName,
      accountId: input.clientType === "app" ? input.accountId : null,
      groupId: input.clientType === "me" ? input.groupId : null,
      createdByAccountId: input.createdByAccountId,
      parentDeviceId: input.parentDeviceId ?? null,
      madeByDeviceId: input.madeByDeviceId ?? null,
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
    clientType,
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
export async function inviteAgent(input: { url: string; displayName: string; scope: ClientScope; createdByAccountId: string; parentDeviceId?: string | null }) {
  if (!isValidScope("agent", input.scope)) throw new Error(`An agent cannot hold the ${input.scope} scope.`);
  const token = randomToken();
  const invite = await prisma().pairing.create({
    data: {
      clientType: "agent",
      scope: input.scope,
      displayName: input.displayName,
      accountId: input.createdByAccountId,
      createdByAccountId: input.createdByAccountId,
      parentDeviceId: input.parentDeviceId ?? null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + AGENT_INVITE_TTL_MS),
    },
  });
  const household = await ensureConnectionIdentity();
  const code = encodePairingCode({ version: PAIRING_CODE_VERSION, clientType: "agent", url: input.url, code: `${invite.id}.${token}`, fingerprint: instanceFingerprint(household.instancePublicKey!) });
  return { invite, code };
}

/** The invite stopped being claimable inside the claim's transaction, which rolls back its claim. */
class VoidInvite extends Error {}

/** The `clientId` belongs to another kind of device. */
class ClientIdInUseError extends Error {
  constructor() {
    super("That identifier belongs to another kind of device.");
  }
}

/** Who a device signs in as: an account, or for a child's phone (`me`) its family group. */
type Signer = { account: Account; group?: undefined } | { account: null; group: { id: string; name: string } };

type Joined = { invite: Pairing; device: { id: string; displayName: string; clientType: string; scope: string }; bearer: ReturnType<typeof bearerSessionData> } & Signer;

/** Creates the device and signs it in, inside the caller's transaction. */
async function join(db: Db, input: {
  invite: Pairing;
  signer: Signer;
  displayName: string;
  clientId?: string | null;
  userAgent?: string | null;
  /** The app version the device runs, when it says (src/server/device-token.ts). */
  appVersion?: string | null;
  now: Date;
}): Promise<Pick<Joined, "device" | "bearer">> {
  const { invite, signer, now } = input;
  const account = signer.account;
  if (!isValidScope(invite.clientType, invite.scope)) throw new Error(`A ${invite.clientType} cannot hold the ${invite.scope} scope.`);
  // A re-paired phone or a re-enrolled companion retires the record it replaces, so it is never listed twice.
  const replaces = invite.replacesDeviceId;
  if (input.clientId) {
    const previous = await db.pairedDevice.findUnique({ where: { clientId: input.clientId } });
    // Only the same client type is replaced: an app's Siri and shortcuts never retire a Watch, nor a Watch them.
    if (previous && (previous.clientType !== invite.clientType || previous.scope !== invite.scope)) throw new ClientIdInUseError();
    if (previous) {
      await db.session.updateMany({ where: { deviceId: previous.id, revokedAt: null }, data: { revokedAt: now } });
      await db.pairedDevice.update({ where: { id: previous.id }, data: { revokedAt: now, clientId: null } });
    }
  }
  // A re-paired phone takes the old one's place, under whatever paired it, even when the old phone made
  // the invite: a phone is never paired from the record it replaces, so revoking that record spares it.
  const parentDeviceId = replaces ? ((await db.pairedDevice.findUnique({ where: { id: replaces } }))?.parentDeviceId ?? null) : invite.parentDeviceId;
  const device = await db.pairedDevice.create({
    data: {
      displayName: input.displayName,
      clientType: invite.clientType,
      scope: invite.scope,
      clientId: input.clientId ?? null,
      accountId: account?.id ?? null,
      groupId: signer.group?.id ?? null,
      parentDeviceId,
      lastSeenAt: now,
      appVersion: input.appVersion ?? null,
    },
  });
  await db.pairing.update({ where: { id: invite.id }, data: { claimedDeviceId: device.id } });
  if (replaces && account) {
    // The new phone keeps what the old one paired when it acts as the same account: its Watch is
    // still its to manage. Anything acting as another account is revoked with the old phone below.
    await db.pairedDevice.updateMany({ where: { parentDeviceId: replaces, accountId: account.id }, data: { parentDeviceId: device.id } });
    await removeDevice(replaces, db, now);
  }
  const bearer = bearerSessionData(now, input.appVersion);
  await db.session.create({
    data: { ...bearer.data, kind: SessionKind.bearer, accountId: account?.id ?? null, username: account ? account.username : meSessionUsername(device.id), deviceId: device.id, userAgent: input.userAgent ?? undefined },
  });
  return { device, bearer };
}

/** A device as a claim names it: its client type and its whole scope (src/lib/client-type.ts). */
export function publicDeviceKind(device: { id: string; displayName: string; clientType: string; scope: string }) {
  return { id: device.id, displayName: device.displayName, clientType: device.clientType, scope: device.scope };
}

/** What a claim answers, the same for every client. Apps and Watches, which may work away from home, also get their manifest. */
export async function claimResponse(joined: Joined, endpoint: Parameters<typeof publicEndpoint>[0] | null) {
  const { invite, device, bearer } = joined;
  const remote = invite.clientType !== "agent";
  const session = joined.account
    ? toPublicSession({ username: joined.account.username, expiresAt: bearer.expiresAt, account: joined.account })
    : toPublicSession({ username: meSessionUsername(device.id), expiresAt: bearer.expiresAt, account: null, device: { clientType: device.clientType, group: joined.group } });
  return {
    device: publicDeviceKind(device),
    session,
    token: bearer.token,
    tokenType: "Bearer" as const,
    refreshToken: bearer.refreshToken,
    refreshExpiresAt: bearer.refreshExpiresAt.toISOString(),
    ...(remote
      ? { connection: { ...(endpoint ? { endpoint: publicEndpoint(endpoint) } : {}), manifest: await signedEndpointManifest({ deviceId: device.id }) } }
      : {}),
  };
}

/** Claims an invite with its single-use token; a phone takes its invite's name. A companion's invite is never claimable here: its phone claimed it already. */
export async function claimInvite(input: { id: string; token: string; displayName: string; userAgent?: string | null; appVersion?: string | null }) {
  const invite = await prisma().pairing.findUnique({ where: { id: input.id }, include: { endpoint: true, account: true, group: { select: { id: true, name: true, kind: true } } } });
  if (!invite || !invite.scope || isCompanion(invite.clientType) || invite.claimedAt || invite.expiresAt <= new Date() || !safeEqual(invite.tokenHash, sha256(input.token))) return null;
  if ((invite.clientType === "app" || invite.clientType === "me") && !invite.endpoint) return null;
  let signer: Signer;
  if (invite.clientType === "me") {
    // A child's phone signs in for its family group, never as an account; one whose group is gone is void.
    if (invite.accountId || !invite.group || invite.group.kind !== GroupKind.family) return null;
    signer = { account: null, group: { id: invite.group.id, name: invite.group.name } };
  } else {
    // Only administrators' own accounts have paired devices: an invite for an adult who has since lost
    // that, or one made before the recovery account was refused, is void.
    if (!mayPairAs(invite.account)) return null;
    signer = { account: invite.account };
  }
  const now = new Date();
  const joined = await prisma().$transaction(async (db) => {
    const claimed = await db.pairing.updateMany({ where: { id: invite.id, claimedAt: null, expiresAt: { gt: now } }, data: { claimedAt: now } });
    if (claimed.count !== 1) return null;
    // A child's phone's group may have gone since the invite was read. Holding its row until the device is
    // made makes deleteGroup, which locks it FOR UPDATE before revoking, wait and then revoke this device;
    // a deletion that already happened voids the invite.
    if (signer.group) {
      const held = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Group" WHERE "id" = ${signer.group.id} FOR SHARE`;
      if (!held.length) throw new VoidInvite();
    }
    // A phone is called what the administrator named it when inviting it; what it calls itself is often just "iPhone".
    const displayName = invite.clientType === "app" || invite.clientType === "me" ? invite.displayName : input.displayName;
    return join(db, { invite, signer, displayName, userAgent: input.userAgent, appVersion: input.appVersion, now });
  }).catch((caught: unknown) => {
    if (caught instanceof VoidInvite) return null;
    throw caught;
  });
  if (!joined) return null;
  return claimResponse({ invite, ...signer, ...joined }, invite.endpoint);
}

/**
 * What an app sets up for itself: its Watch (`app-watch`), and its own sign-in for Siri, Shortcuts and
 * system controls (`app-controls`). Both hold `app:rulesOnly`.
 */
export type CompanionClient = Extract<ClientType, "app-watch" | "app-controls">;

/** A device another device sets up and claims at once: an app's companions, and FamilyFi Me's Watch. */
function isCompanion(clientType: string): boolean {
  return clientType === "app-watch" || clientType === "app-controls" || clientType === "me-watch";
}

/**
 * An app invites its Watch, or its own `rulesOnly` sign-in, and claims it in one transaction. Neither
 * makes a network call to join: the app hands it the tokens and manifest. Re-enrolling the same
 * `clientId` retires the old record.
 */
async function inviteAndClaimCompanion(input: { clientType: CompanionClient; parentDeviceId: string; account: Account; clientId: string; displayName: string; userAgent?: string | null; appVersion?: string | null }) {
  const now = new Date();
  const joined = await prisma().$transaction(async (db) => {
    const invite = await db.pairing.create({
      data: {
        clientType: input.clientType,
        scope: "app:rulesOnly",
        displayName: input.displayName,
        accountId: input.account.id,
        createdByAccountId: input.account.id,
        parentDeviceId: input.parentDeviceId,
        tokenHash: sha256(randomToken()),
        expiresAt: now,
        claimedAt: now,
      },
    });
    return { invite, ...(await join(db, { invite, signer: { account: input.account }, displayName: input.displayName, clientId: input.clientId, userAgent: input.userAgent, appVersion: input.appVersion, now })) };
  });
  return { invite: joined.invite, claim: await claimResponse({ ...joined, account: input.account }, null) };
}

/**
 * FamilyFi Me on a child's phone invites its Watch and claims it in one transaction, as an app does
 * its own: the Watch signs in for the phone's family group with `me:askOnly`, and the phone is its
 * parent, so revoking the phone revokes the Watch. Re-enrolling the same `clientId` retires the old record.
 */
async function inviteAndClaimMeWatch(input: { parentDeviceId: string; createdByAccountId: string; group: { id: string; name: string }; clientId: string; displayName: string; userAgent?: string | null; appVersion?: string | null }) {
  const now = new Date();
  const signer: Signer = { account: null, group: input.group };
  const joined = await prisma().$transaction(async (db) => {
    // As a phone's claim does: hold the group so a deletion waits and then revokes this Watch too.
    const held = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Group" WHERE "id" = ${input.group.id} FOR SHARE`;
    if (!held.length) throw new VoidInvite();
    const invite = await db.pairing.create({
      data: {
        clientType: "me-watch",
        scope: "me:askOnly",
        displayName: input.displayName,
        groupId: input.group.id,
        createdByAccountId: input.createdByAccountId,
        parentDeviceId: input.parentDeviceId,
        tokenHash: sha256(randomToken()),
        expiresAt: now,
        claimedAt: now,
      },
    });
    return { invite, ...(await join(db, { invite, signer, displayName: input.displayName, clientId: input.clientId, userAgent: input.userAgent, appVersion: input.appVersion, now })) };
  });
  return { invite: joined.invite, claim: await claimResponse({ ...joined, ...signer }, null) };
}

/** Ends a pending invite early. Expiring it, rather than deleting it, keeps the claim path's single check. */
export async function cancelInvite(id: string): Promise<boolean> {
  const now = new Date();
  const cancelled = await prisma().pairing.updateMany({ where: { id, claimedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  return cancelled.count === 1;
}

/** What every refusal to pair as the recovery account says. */
const RECOVERY_REFUSED = "No device signs in as the recovery admin. Choose a personal administrator, or sign in as one.";

/** What a companion is called when its app names none. */
const COMPANION_NAME = { "app-watch": "Apple Watch", "app-controls": "Shortcuts and controls", "me-watch": "Watch" } as const;

function inviteBody(invite: { id: string; expiresAt: Date }, code: string) {
  return { invite: { id: invite.id, expiresAt: invite.expiresAt.toISOString(), code } };
}

type InviteInput =
  | { clientType: "app"; displayName: string; endpointId: string; accountId?: string; replacesDeviceId?: string }
  | { clientType: "me"; displayName: string; endpointId: string; personId: string }
  | { clientType: "agent"; displayName: string; scope: ClientScope };

/**
 * An administrator invites a phone, a child's phone or an agent and gets a single-use code. An invite
 * a paired phone makes for its own kind of device names it as the device's parent, so revoking the
 * phone revokes that device too; a child's phone belongs to its group instead.
 * `from` is how the request came in: through the tunnel or not, and the address it was made at.
 */
export async function inviteDevice(session: SignedInSession, input: InviteInput, from: { tunnelled: boolean; origin: string }) {
  if (!session.accountId) throw new ApiError(403, "administrator_required", "Sign in with an account to invite a device.");
  const parentDeviceId = session.deviceId ?? null;
  if (input.clientType === "agent") {
    if (from.tunnelled) throw new ApiError(403, "agent_remote", "Connect an agent from the FamilyFi web app on the home network.");
    // An agent acts as whoever invites it.
    if (!mayPairAs(session.account)) throw new ApiError(403, "personal_account_required", "An agent acts as whoever connects it, and nothing acts as the recovery admin. Sign in as yourself to connect one.");
    // The code carries the home network address, or else the one it was made at: the browser's
    // address can be a proxy with its own sign-in page, which an agent cannot get past.
    const household = await loadHousehold();
    const url = household.homeUrl ?? from.origin;
    const { invite, code } = await inviteAgent({ url, displayName: input.displayName, scope: input.scope, createdByAccountId: session.accountId, parentDeviceId });
    const body = inviteBody(invite, code);
    return { invite: { ...body.invite, url } };
  }
  const endpoint = await prisma().connectionEndpoint.findFirst({ where: { id: input.endpointId, householdId: currentHouseholdId(), enabled: true } });
  if (!endpoint) throw new ApiError(404, "not_found", "Connection endpoint not found.");
  if (input.clientType === "me") {
    const group = await prisma().group.findUnique({ where: { id: input.personId }, select: { id: true, kind: true } });
    if (!group) throw new ApiError(404, "not_found", "Person not found.");
    if (group.kind !== GroupKind.family) throw new ApiError(400, "family_group_required", "FamilyFi Me signs in for a person's group, not a group of things.");
    const { invite, code } = await invitePhone({ clientType: "me", endpointId: endpoint.id, displayName: input.displayName, groupId: group.id, createdByAccountId: session.accountId, madeByDeviceId: parentDeviceId });
    return inviteBody(invite, code);
  }
  const accountId = input.accountId ?? session.accountId;
  const account = await prisma().account.findUnique({ where: { id: accountId } });
  if (!account) throw new ApiError(404, "not_found", "The account to sign the phone in as no longer exists.");
  // Only administrators have paired phones: a phone controls the household and its agents.
  if (!isAdministratorAccount(account)) {
    throw new ApiError(400, "administrator_account_required", "A phone signs in only as an administrator.");
  }
  if (!mayPairAs(account)) throw new ApiError(400, "personal_account_required", RECOVERY_REFUSED);
  // Only a phone is re-paired as a phone: a Watch or agent is never replaced, and so never removed, this way.
  if (input.replacesDeviceId && !isFullApp(await prisma().pairedDevice.findUnique({ where: { id: input.replacesDeviceId } }))) {
    throw new ApiError(404, "not_found", "The phone to re-pair no longer exists.");
  }
  const { invite, code } = await invitePhone({ clientType: "app", endpointId: endpoint.id, displayName: input.displayName, accountId, createdByAccountId: session.accountId, parentDeviceId, replacesDeviceId: input.replacesDeviceId });
  return inviteBody(invite, code);
}

/**
 * The paired app a companion is claimed by. Only a signed-in paired app (`app:full`) claims its Watch
 * or its own `rulesOnly` sign-in: no browser ever receives another device's tokens.
 */
export function companionHost(session: SignedInSession) {
  if (session.kind !== SessionKind.bearer || !isFullApp(session.device) || !session.account) {
    throw new ApiError(403, "paired_phone_required", "Only a signed-in paired phone can invite and claim its Watch or its Siri and shortcuts.");
  }
  if (!mayPairAs(session.account)) throw new ApiError(403, "personal_account_required", RECOVERY_REFUSED);
  // Its Watch and its Siri sign-in come with the app that sets them up, so they share its version.
  return { deviceId: session.device.id, account: session.account, appVersion: session.appVersion };
}

/**
 * The child's phone FamilyFi Me's Watch is claimed by: a signed-in FamilyFi Me (`me`) whose family
 * group is still there. Its Watch never sets up another, and no app or browser sets one up for it.
 */
export async function meWatchHost(session: SignedInSession) {
  const device = session.kind === SessionKind.bearer ? session.device : null;
  if (!device || device.clientType !== "me" || device.scope !== "me:askOnly" || session.account || !device.groupId) {
    throw new ApiError(403, "me_phone_required", "Only FamilyFi Me on a person's phone can set up its Watch.");
  }
  const group = await prisma().group.findUnique({ where: { id: device.groupId }, select: { id: true, name: true, kind: true } });
  if (!group || group.kind !== GroupKind.family) throw new ApiError(403, "me_phone_required", "Only FamilyFi Me on a person's phone can set up its Watch.");
  // The Watch is set up by whoever paired the phone, as far as the record goes.
  const paired = await prisma().pairing.findFirst({ where: { claimedDeviceId: device.id }, select: { createdByAccountId: true } });
  if (!paired) throw new ApiError(403, "me_phone_required", "Only FamilyFi Me on a person's phone can set up its Watch.");
  // The Watch ships inside FamilyFi Me, so it shares the phone's version.
  return { deviceId: device.id, createdByAccountId: paired.createdByAccountId, group: { id: group.id, name: group.name }, appVersion: session.appVersion };
}

/** FamilyFi Me's phone sets up its Watch and claims it at once. */
export async function claimMeWatch(host: Awaited<ReturnType<typeof meWatchHost>>, input: { clientId: string; displayName?: string }, userAgent: string | null) {
  let joined: Awaited<ReturnType<typeof inviteAndClaimMeWatch>>;
  try {
    joined = await inviteAndClaimMeWatch({ parentDeviceId: host.deviceId, createdByAccountId: host.createdByAccountId, group: host.group, clientId: input.clientId, displayName: input.displayName ?? COMPANION_NAME["me-watch"], userAgent, appVersion: host.appVersion });
  } catch (caught) {
    if (caught instanceof ClientIdInUseError) throw new ApiError(409, "client_id_in_use", caught.message);
    if (caught instanceof VoidInvite) throw new ApiError(403, "me_phone_required", "Only FamilyFi Me on a person's phone can set up its Watch.");
    throw caught;
  }
  const { invite, claim } = joined;
  return { invite: { id: invite.id, expiresAt: invite.expiresAt.toISOString(), status: "claimed" }, ...claim };
}

/** A paired app invites its Watch, or its own `rulesOnly` sign-in, and claims it at once. */
export async function claimCompanion(
  host: ReturnType<typeof companionHost>,
  input: { clientType: CompanionClient; clientId: string; displayName?: string },
  userAgent: string | null,
) {
  let joined: Awaited<ReturnType<typeof inviteAndClaimCompanion>>;
  try {
    joined = await inviteAndClaimCompanion({
      clientType: input.clientType,
      parentDeviceId: host.deviceId,
      account: host.account,
      clientId: input.clientId,
      displayName: input.displayName ?? COMPANION_NAME[input.clientType],
      userAgent,
      appVersion: host.appVersion,
    });
  } catch (caught) {
    if (caught instanceof ClientIdInUseError) throw new ApiError(409, "client_id_in_use", caught.message);
    throw caught;
  }
  const { invite, claim } = joined;
  return { invite: { id: invite.id, expiresAt: invite.expiresAt.toISOString(), status: "claimed" }, ...claim };
}

/** An invite's status, so the screen that made it can tell when it was claimed. */
export async function getInvite(id: string) {
  const invite = await prisma().pairing.findUnique({ where: { id }, include: { claimedDevice: true } });
  if (!invite) throw new ApiError(404, "not_found", "Invite not found.");
  return {
    id: invite.id,
    status: inviteStatus(invite),
    expiresAt: invite.expiresAt.toISOString(),
    device: invite.claimedDevice ? { id: invite.claimedDevice.id, displayName: invite.claimedDevice.displayName } : null,
  };
}

/**
 * Joins with an invite's single-use code, the way every device does. An agent never joins through
 * the tunnel. A refusal comes back as a result, not a throw: the claim route has no guard to answer one.
 */
export async function claimInviteFrom(input: Parameters<typeof claimInvite>[0] & { tunnelled: boolean }) {
  if (input.tunnelled) {
    const invite = await prisma().pairing.findUnique({ where: { id: input.id }, select: { clientType: true } });
    if (invite?.clientType === "agent") {
      return { ok: false as const, status: 403, code: "agent_remote", message: "Agents connect from the home network only." };
    }
  }
  const claim = await claimInvite(input);
  if (!claim) return { ok: false as const, status: 403, code: "invalid_pairing", message: "This invite is invalid, expired, or already used." };
  return { ok: true as const, claim };
}

/** Cancels an invite nobody has claimed yet. */
export async function cancelPendingInvite(id: string) {
  if (!(await cancelInvite(id))) throw new ApiError(404, "not_found", "No pending invite with that id.");
}
