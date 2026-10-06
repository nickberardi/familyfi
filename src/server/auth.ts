import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { type Account, AccountKind, type DeviceScope, PairedDeviceClient, SessionKind } from "@prisma/client";
import { cookieValue } from "@/lib/cookie";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";
import { demoModeEnabled, recoveryPassword } from "./env";
import { originAllowed } from "./origin";
import { ensureQuarantineRule } from "./rules";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  RECOVERY_USERNAME,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  TUNNEL_HEADER,
} from "@/lib/constants";
import { jsonError } from "./http";
import { deviceRouteAllowed } from "./device-scope";

const ARGON2 = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

export type PublicSession = {
  username: string;
  displayName: string;
  kind: "recovery" | "personal";
  expiresAt: string;
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password, ARGON2);
}

export async function ensureRecoveryAccount() {
  await prisma().account.upsert({
    where: { username: RECOVERY_USERNAME },
    update: {
      kind: AccountKind.recovery,
      isAdmin: true,
      passwordHash: null,
      displayName: "Recovery admin",
    },
    create: {
      username: RECOVERY_USERNAME,
      displayName: "Recovery admin",
      kind: AccountKind.recovery,
      isAdmin: true,
    },
  });
}

export async function ensureHousehold() {
  await prisma().household.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  await ensureQuarantineRule();
}

export function requestIsHttps(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    // ignore malformed URLs
  }
  const proto = request.headers.get("x-forwarded-proto");
  const forwarded = request.headers.get("x-forwarded-host") || request.headers.get("forwarded");
  if (!proto || !forwarded) return false;
  return proto.split(",")[0]?.trim() === "https";
}

/** The origin the caller reached this server at, as a browser on the home network sees it. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${requestIsHttps(request) ? "https" : "http"}://${host}`;
}

export function cookieOptions(maxAgeSeconds: number, secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function csrfCookieOptions(maxAgeSeconds: number, secure: boolean) {
  return {
    ...cookieOptions(maxAgeSeconds, secure),
    httpOnly: false as const,
  };
}

export async function isThrottled(username: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const [byUser, byIp] = await Promise.all([
    prisma().loginAttempt.count({
      where: { username: username.toLowerCase(), success: false, createdAt: { gt: since } },
    }),
    prisma().loginAttempt.count({
      where: { ip, success: false, createdAt: { gt: since } },
    }),
  ]);
  // The demo shows its one login to every visitor, so a per-username limit would only let one visitor
  // lock everyone else out; there the limit is per address alone.
  return (!demoModeEnabled() && byUser >= LOGIN_MAX_FAILURES) || byIp >= LOGIN_MAX_FAILURES;
}

async function recordAttempt(input: {
  username: string;
  ip: string;
  success: boolean;
  accountId?: string | null;
}) {
  await prisma().loginAttempt.create({
    data: {
      username: input.username.toLowerCase(),
      ip: input.ip,
      success: input.success,
      accountId: input.accountId ?? undefined,
    },
  });
}

/**
 * Only administrators use FamilyFi: an adult without administrator access is like a child, with no
 * sign-in, session or paired device. The recovery account always is one.
 */
export function isAdministratorAccount(account: Pick<Account, "kind" | "isAdmin"> | null | undefined): boolean {
  return account?.kind === AccountKind.recovery || account?.isAdmin === true;
}

export async function authenticate(usernameRaw: string, password: string, ip: string) {
  const username = usernameRaw.trim().toLowerCase();
  if (!username || !password) {
    return { ok: false as const, status: 400 as const, code: "invalid_request", message: "Username and password are required." };
  }
  if (await isThrottled(username, ip)) {
    return {
      ok: false as const,
      status: 429 as const,
      code: "throttled",
      message: "Too many failed sign-in attempts. Try again in 15 minutes.",
    };
  }

  await ensureRecoveryAccount();
  const account = await prisma().account.findUnique({ where: { username } });

  let valid = false;
  if (username === RECOVERY_USERNAME) {
    const expected = recoveryPassword();
    valid = expected.length === password.length && safeEqual(password, expected);
  } else if (account?.passwordHash && account.kind === AccountKind.personal) {
    valid = await verifyPassword(account.passwordHash, password);
  }

  // A non-administrator's right password still counts as a failure, so the refusal below cannot be
  // used to test passwords past the throttle.
  await recordAttempt({ username, ip, success: valid && isAdministratorAccount(account), accountId: account?.id });
  if (!valid || !account) {
    return { ok: false as const, status: 401 as const, code: "invalid_credentials", message: "Invalid username or password." };
  }

  if (!isAdministratorAccount(account)) {
    return { ok: false as const, status: 403 as const, code: "administrator_account_required", message: "Only administrators sign in to FamilyFi." };
  }
  return { ok: true as const, account };
}

export async function createSession(input: {
  accountId: string;
  username: string;
  kind: SessionKind;
  userAgent?: string | null;
  deviceId?: string | null;
}) {
  if (input.kind === SessionKind.bearer) {
    const bearer = bearerSessionData();
    await prisma().session.create({
      data: { ...bearer.data, kind: input.kind, accountId: input.accountId, username: input.username, userAgent: input.userAgent ?? undefined, deviceId: input.deviceId ?? undefined },
    });
    return { raw: bearer.token, expiresAt: bearer.expiresAt, refresh: bearer.refreshToken, refreshExpiresAt: bearer.refreshExpiresAt, csrf: randomToken(24) };
  }
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma().session.create({
    data: {
      tokenHash: sha256(raw),
      kind: input.kind,
      accountId: input.accountId,
      username: input.username,
      expiresAt,
      userAgent: input.userAgent ?? undefined,
      deviceId: input.deviceId ?? undefined,
    },
  });
  return { raw, expiresAt, refresh: null, refreshExpiresAt: null, csrf: randomToken(24) };
}

/**
 * A paired device's token pair: an access token that lives an hour and the refresh token that
 * renews it. Only their hashes are stored; the raw values are returned to the device once.
 */
export function bearerSessionData(now = new Date()) {
  const token = randomToken();
  const refreshToken = randomToken();
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  return {
    token,
    refreshToken,
    expiresAt,
    refreshExpiresAt,
    data: { tokenHash: sha256(token), expiresAt, refreshTokenHash: sha256(refreshToken), refreshExpiresAt },
  };
}

export type RefreshResult =
  | { ok: true; session: { username: string; expiresAt: Date; account: { displayName: string; kind: AccountKind } | null }; token: string; refreshToken: string; refreshExpiresAt: Date }
  | { ok: false; code: "invalid_refresh" | "refresh_reused" | "agent_remote"; message: string };

const INVALID_REFRESH = { ok: false as const, code: "invalid_refresh" as const, message: "This refresh token is invalid or expired. Sign in again." };

/**
 * Trades a refresh token for a new token pair, retiring both old tokens. The refresh token just
 * replaced is honoured once for a few seconds, for a device that lost the response; any later use
 * of it means a copy exists, so the whole sign-in is revoked.
 */
export async function refreshSession(refreshToken: string, options: { tunnelled?: boolean; now?: Date } = {}): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const presented = sha256(refreshToken);
  const include = { account: true, device: true } as const;
  let session = await prisma().session.findUnique({ where: { refreshTokenHash: presented }, include });
  let current = presented;
  let grace = false;
  if (!session) {
    const replaced = await prisma().session.findUnique({ where: { previousRefreshHash: presented }, include });
    if (!replaced) return INVALID_REFRESH;
    if (!replaced.previousRefreshUntil || replaced.previousRefreshUntil <= now) {
      await prisma().session.updateMany({ where: { id: replaced.id, revokedAt: null }, data: { revokedAt: now } });
      return { ok: false, code: "refresh_reused", message: "This refresh token was already used, so this sign-in has ended. Sign in again." };
    }
    session = replaced;
    current = replaced.refreshTokenHash!;
    grace = true;
  }
  if (session.revokedAt || session.kind !== SessionKind.bearer || !session.refreshExpiresAt || session.refreshExpiresAt <= now || !session.device || session.device.revokedAt) return INVALID_REFRESH;
  // A device acting as an adult who is no longer an administrator has no sign-in to renew.
  if (session.account && !isAdministratorAccount(session.account)) return INVALID_REFRESH;
  // Remote access is for the household's phones; an agent renews from the home network or not at all.
  if (options.tunnelled && session.device.client === PairedDeviceClient.agent) return { ok: false, code: "agent_remote", message: "Agents connect from the home network only." };

  const next = bearerSessionData(now);
  const rotated = await prisma().session.updateMany({
    where: { id: session.id, refreshTokenHash: current, revokedAt: null },
    data: {
      ...next.data,
      // A grace retry closes the window, so the replaced token is honoured only once.
      previousRefreshHash: presented,
      previousRefreshUntil: grace ? now : new Date(now.getTime() + REFRESH_REUSE_GRACE_MS),
    },
  });
  if (rotated.count !== 1) return INVALID_REFRESH;
  await prisma().pairedDevice.update({ where: { id: session.device.id }, data: { lastSeenAt: now } });
  return { ok: true, session: { username: session.username, expiresAt: next.expiresAt, account: session.account }, token: next.token, refreshToken: next.refreshToken, refreshExpiresAt: next.refreshExpiresAt };
}

/** The session token a request carries: its bearer, or else its session cookie. */
async function presentedToken(request: Request): Promise<string | undefined> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const raw = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (raw) return raw;
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export async function readSessionFromRequest(request: Request) {
  const raw = await presentedToken(request);
  if (!raw) return null;
  const session = await prisma().session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { account: true, device: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || (session.kind === SessionKind.bearer && (!session.device || session.device.revokedAt))) return null;
  // Only administrators use FamilyFi; demotion ends their sessions, and this refuses any left over.
  if (session.account && !isAdministratorAccount(session.account)) return null;
  if (session.device && (!session.device.lastSeenAt || session.device.lastSeenAt < new Date(Date.now() - 15 * 60 * 1000))) {
    await prisma().pairedDevice.update({ where: { id: session.device.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export function toPublicSession(session: {
  username: string;
  expiresAt: Date;
  account: { displayName: string; kind: AccountKind } | null;
}): PublicSession {
  return {
    username: session.username,
    displayName: session.account?.displayName ?? "Recovery admin",
    kind: session.account?.kind === AccountKind.personal ? "personal" : "recovery",
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function requireSession(request: Request) {
  const session = await readSessionFromRequest(request);
  if (!session) return { session: null, error: jsonError(401, "unauthenticated", "Sign in required.") };
  const device = session.device;
  if (device) {
    if (device.client === PairedDeviceClient.agent && request.headers.get(TUNNEL_HEADER) === "tunnel") {
      return { session: null, error: jsonError(403, "agent_remote", "Agents connect from the home network only.") };
    }
    const refused = deviceScopeRefusal(device, request.method, new URL(request.url).pathname);
    if (refused) return { session: null, error: refused };
  }
  return { session, error: null };
}

/** The 403 a paired device gets for a call its scope does not cover, or null when it may make it. */
export function deviceScopeRefusal(
  device: { id: string; client: PairedDeviceClient; scope: DeviceScope },
  method: string,
  path: string,
): Response | null {
  if (deviceRouteAllowed({ client: device.client, scope: device.scope, deviceId: device.id, method, path })) return null;
  // Signed in but not allowed: 403, never 401, which clients read as "renew or sign in again".
  if (device.client === PairedDeviceClient.agent) {
    return jsonError(403, "agent_scope", "This agent's scope does not cover that request. Ask the person you are helping to do it in the FamilyFi web app.");
  }
  return jsonError(403, "watch_scope", "This Watch session cannot use that endpoint.");
}

export { originAllowed };

export async function requireCsrf(request: Request) {
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  }
  if (request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  let cookie = cookieValue(request.headers.get("cookie"), CSRF_COOKIE);
  if (!cookie) {
    try {
      cookie = (await cookies()).get(CSRF_COOKIE)?.value;
    } catch {
      cookie = undefined;
    }
  }
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return jsonError(403, "csrf", "Missing or invalid CSRF token.");
  }
  return null;
}

/**
 * Signs out the session the request carries, even when its bearer has expired: a paired device's
 * refresh token lives on the same row and must end with it.
 */
export async function revokeSession(request: Request) {
  const raw = await presentedToken(request);
  if (raw) await prisma().session.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAccountSessions(accountId: string) {
  await prisma().session.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { CSRF_COOKIE, SESSION_COOKIE, cookieOptions as sessionCookieOptions };
