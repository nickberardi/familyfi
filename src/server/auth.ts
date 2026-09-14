import { hash, verify } from "@node-rs/argon2";
import { cookies } from "next/headers";
import { AccountKind, SessionKind } from "@prisma/client";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { prisma } from "./db";
import { env } from "./env";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  RECOVERY_USERNAME,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/constants";
import { jsonError } from "./http";

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
  await prisma().household.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

export function requestIsHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
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
  return byUser >= LOGIN_MAX_FAILURES || byIp >= LOGIN_MAX_FAILURES;
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
    valid = safeEqual(password, env().DEFAULT_PASSWORD);
  } else if (account?.passwordHash && account.kind === AccountKind.personal) {
    valid = await verifyPassword(account.passwordHash, password);
  }

  await recordAttempt({ username, ip, success: valid, accountId: account?.id });
  if (!valid || !account) {
    return { ok: false as const, status: 401 as const, code: "invalid_credentials", message: "Invalid username or password." };
  }

  return { ok: true as const, account };
}

export async function createSession(input: {
  accountId: string;
  username: string;
  kind: SessionKind;
  userAgent?: string | null;
}) {
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
    },
  });
  return { raw, expiresAt, csrf: randomToken(24) };
}

export async function readSessionFromRequest(request: Request) {
  const header = request.headers.get("authorization");
  let raw: string | undefined;
  if (header?.toLowerCase().startsWith("bearer ")) {
    raw = header.slice(7).trim();
  } else {
    const jar = await cookies();
    raw = jar.get(SESSION_COOKIE)?.value;
  }
  if (!raw) return null;
  const session = await prisma().session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { account: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
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
  return { session, error: null };
}

export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function requireCsrf(request: Request) {
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  }
  if (request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const jar = await cookies();
  const cookie = jar.get(CSRF_COOKIE)?.value;
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return jsonError(403, "csrf", "Missing or invalid CSRF token.");
  }
  return null;
}

export async function revokeSession(request: Request) {
  const session = await readSessionFromRequest(request);
  if (session) {
    await prisma().session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }
}

export async function revokeAccountSessions(accountId: string) {
  await prisma().session.updateMany({
    where: { accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { CSRF_COOKIE, SESSION_COOKIE, cookieOptions as sessionCookieOptions };
