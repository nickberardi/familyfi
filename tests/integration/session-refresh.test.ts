import { beforeEach, describe, expect, it } from "vitest";
import { AccountKind, SessionKind } from "@prisma/client";
import { ACCESS_TOKEN_TTL_MS, REFRESH_REUSE_GRACE_MS, REFRESH_TOKEN_TTL_MS } from "@/lib/constants";
import { createSession, hashPassword, revokeAccountSessions } from "@/server/auth";
import { sha256 } from "@/server/crypto";
import { prisma } from "@/server/db";
import { tunnelHeaders } from "@/server/tunnel/phone-gateway";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { DELETE as revokeDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimWatchRequest, pairPhone } from "../helpers/pairing";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const json = { "content-type": "application/json" };

type Pair = { token: string; refreshToken: string; refreshExpiresAt: string; session: { expiresAt: string } };

function adminAuth() {
  return login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) })).then((response) => authFromLogin(response));
}

/** A phone joined by an invite: pairing signs it in, with no password. */
async function phoneLogin(): Promise<Pair & { deviceId: string }> {
  const claim = await pairPhone(await adminAuth());
  return { ...claim, deviceId: claim.device.id };
}

function refreshWith(refreshToken: string, headers: Record<string, string> = {}) {
  return refresh(request("/api/v1/auth/refresh", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ refreshToken }) }));
}

async function refreshed(refreshToken: string): Promise<Pair> {
  const response = await refreshWith(refreshToken);
  expect(response.status).toBe(200);
  return (await response.json()) as Pair;
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

async function signedIn(token: string) {
  return (await currentSession(request("/api/v1/auth/session", { auth: bearer(token) }))).status === 200;
}

/** Moves the clock past a window by moving the stored timestamps back instead. */
async function age(refreshToken: string, field: "previousRefreshUntil" | "refreshExpiresAt") {
  const hash = sha256(refreshToken);
  const where = field === "previousRefreshUntil" ? { previousRefreshHash: hash } : { refreshTokenHash: hash };
  await prisma().session.updateMany({ where, data: { [field]: new Date(Date.now() - 1000) } });
}

describe("refresh tokens for paired devices", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives a paired phone a one-hour bearer and a 90-day refresh token; a browser gets neither", async () => {
    const pair = await phoneLogin();
    const accessLeft = new Date(pair.session.expiresAt).getTime() - Date.now();
    expect(accessLeft).toBeGreaterThan(ACCESS_TOKEN_TTL_MS - 60_000);
    expect(accessLeft).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_MS);
    expect(new Date(pair.refreshExpiresAt).getTime() - Date.now()).toBeGreaterThan(REFRESH_TOKEN_TTL_MS - 60_000);

    const browser = await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) }));
    expect(browser.status).toBe(200);
    expect(await browser.json()).not.toHaveProperty("refreshToken");
    const cookie = await prisma().session.findFirstOrThrow({ where: { kind: SessionKind.cookie } });
    expect(cookie.refreshTokenHash).toBeNull();
  });

  it("gives a Watch its phone claimed its own refresh token", async () => {
    const pair = await phoneLogin();
    const response = await claimWatchRequest(bearer(pair.token));
    expect(response.status).toBe(201);
    const watch = (await response.json()) as { token: string; refreshToken: string };
    const renewed = await refreshed(watch.refreshToken);
    expect(await signedIn(renewed.token)).toBe(true);
  });

  it("rotates both tokens: the old bearer stops working and the new one works", async () => {
    const pair = await phoneLogin();
    const next = await refreshed(pair.refreshToken);
    expect(next.token).not.toBe(pair.token);
    expect(next.refreshToken).not.toBe(pair.refreshToken);
    expect(await signedIn(pair.token)).toBe(false);
    expect(await signedIn(next.token)).toBe(true);
  });

  it("works after the bearer has expired, and moves the refresh window forward", async () => {
    const pair = await phoneLogin();
    await prisma().session.updateMany({ where: { refreshTokenHash: sha256(pair.refreshToken) }, data: { expiresAt: new Date(Date.now() - 1000), refreshExpiresAt: new Date(Date.now() + 60_000) } });
    expect(await signedIn(pair.token)).toBe(false);
    await prisma().pairedDevice.update({ where: { id: pair.deviceId }, data: { lastSeenAt: new Date(0) } });
    const next = await refreshed(pair.refreshToken);
    expect(new Date(next.refreshExpiresAt).getTime() - Date.now()).toBeGreaterThan(REFRESH_TOKEN_TTL_MS - 60_000);
    // A device that only refreshes is still seen.
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: pair.deviceId } })).lastSeenAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await signedIn(next.token)).toBe(true);
  });

  it("honours a just-replaced refresh token once, for a lost response", async () => {
    const pair = await phoneLogin();
    const lost = await refreshed(pair.refreshToken);
    const retried = await refreshed(pair.refreshToken);
    expect(await signedIn(retried.token)).toBe(true);
    // The pair the device never received is dead.
    expect(await signedIn(lost.token)).toBe(false);
    expect((await refreshWith(lost.refreshToken)).status).toBe(403);
    // A second retry is reuse.
    const again = await refreshWith(pair.refreshToken);
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe("refresh_reused");
  });

  it("ends the whole sign-in when a replaced refresh token is used after the grace", async () => {
    const pair = await phoneLogin();
    const next = await refreshed(pair.refreshToken);
    await age(pair.refreshToken, "previousRefreshUntil");
    const reused = await refreshWith(pair.refreshToken);
    expect(reused.status).toBe(403);
    expect(await errorCode(reused)).toBe("refresh_reused");
    expect(await signedIn(next.token)).toBe(false);
    expect(await errorCode(await refreshWith(next.refreshToken))).toBe("invalid_refresh");
    expect(REFRESH_REUSE_GRACE_MS).toBeLessThanOrEqual(10_000);
  });

  it("refuses an expired or unknown refresh token", async () => {
    const pair = await phoneLogin();
    await age(pair.refreshToken, "refreshExpiresAt");
    expect(await errorCode(await refreshWith(pair.refreshToken))).toBe("invalid_refresh");
    expect(await errorCode(await refreshWith("not-a-refresh-token"))).toBe("invalid_refresh");
  });

  it("ends refresh when the device is revoked, on sign-out, and on a password change", async () => {
    const revoked = await phoneLogin();
    const response = await revokeDevice(request(`/api/v1/paired/devices/${revoked.deviceId}`, { method: "DELETE", auth: bearer(revoked.token) }), { params: Promise.resolve({ id: revoked.deviceId }) });
    expect(response.status).toBe(200);
    expect((await refreshWith(revoked.refreshToken)).status).toBe(403);

    await resetDatabase();
    const signedOut = await phoneLogin();
    expect((await logout(request("/api/v1/auth/logout", { method: "POST", auth: bearer(signedOut.token) }))).status).toBe(200);
    expect((await refreshWith(signedOut.refreshToken)).status).toBe(403);

    // Signing out an hour after the last refresh, with an expired bearer, still ends the refresh token.
    await resetDatabase();
    const expired = await phoneLogin();
    await prisma().session.updateMany({ where: { refreshTokenHash: sha256(expired.refreshToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await logout(request("/api/v1/auth/logout", { method: "POST", auth: bearer(expired.token) }))).status).toBe(200);
    expect((await refreshWith(expired.refreshToken)).status).toBe(403);

    await resetDatabase();
    const rotatedPassword = await phoneLogin();
    const account = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    await revokeAccountSessions(account.id);
    expect((await refreshWith(rotatedPassword.refreshToken)).status).toBe(403);
  });

  it("lets exactly one of two concurrent refreshes win", async () => {
    const pair = await phoneLogin();
    const responses = await Promise.all([refreshWith(pair.refreshToken), refreshWith(pair.refreshToken)]);
    // The second either lost the race (403) or arrived just after and was honoured as the grace
    // retry, which retires the first's pair. Either way exactly one bearer works.
    const pairs = await Promise.all(responses.filter((response) => response.status === 200).map((response) => response.json() as Promise<Pair>));
    expect(pairs.length).toBeGreaterThan(0);
    const working = await Promise.all(pairs.map((issued) => signedIn(issued.token)));
    expect(working.filter(Boolean)).toHaveLength(1);
  });

  it("works for a phone through remote access", async () => {
    const pair = await phoneLogin();
    const lan = request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken: pair.refreshToken }) });
    const tunnelled = new Request(lan.url, { method: "POST", headers: tunnelHeaders(Object.fromEntries(lan.headers.entries())) as Record<string, string>, body: JSON.stringify({ refreshToken: pair.refreshToken }) });
    expect((await refresh(tunnelled)).status).toBe(200);
  });

  it("refuses to refresh a bearer session that belongs to no paired device", async () => {
    const account = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    const loose = await createSession({ accountId: account.id, username: account.username, kind: SessionKind.bearer });
    expect(loose.refresh).toBeTruthy();
    expect(await errorCode(await refreshWith(loose.refresh!))).toBe("invalid_refresh");
  });

  it("lists a paired device's sign-in until its refresh token ends, not its bearer", async () => {
    const pair = await phoneLogin();
    await prisma().session.updateMany({ where: { refreshTokenHash: sha256(pair.refreshToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const admin = await adminAuth();
    const { devices } = (await (await listDevices(request("/api/v1/paired/devices", { auth: admin }))).json()) as { devices: { id: string; sessions: { expiresAt: string }[] }[] };
    const listed = devices.find((device) => device.id === pair.deviceId)!;
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0].expiresAt).toBe(pair.refreshExpiresAt);
  });

  it("refuses to renew a device whose adult is no longer an administrator", async () => {
    const adult = await prisma().account.create({ data: { username: "sam", displayName: "Sam", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("sam-password-1") } });
    const claim = await pairPhone(await adminAuth(), { accountId: adult.id });
    await prisma().account.update({ where: { id: adult.id }, data: { isAdmin: false } });
    expect(await errorCode(await refreshWith(claim.refreshToken))).toBe("invalid_refresh");
    expect(await signedIn(claim.token)).toBe(false);
  });
});
