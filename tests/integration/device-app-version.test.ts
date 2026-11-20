import { beforeEach, describe, expect, it } from "vitest";
import { readSessionFromRequest } from "@/server/auth";
import { deviceTokenAppVersion } from "@/server/device-token";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimInvite, claimWatchRequest, invitePhoneRequest, issuedInvite, homeRoute, pairingAdminAuth, pairPhone } from "../helpers/pairing";

const json = { "content-type": "application/json" };
type Pair = { token: string; refreshToken: string };

function refreshWith(refreshToken: string, extra: Record<string, unknown> = {}) {
  return refresh(request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken, ...extra }) }));
}

async function refreshed(refreshToken: string, extra: Record<string, unknown> = {}): Promise<Pair> {
  const response = await refreshWith(refreshToken, extra);
  expect(response.status).toBe(200);
  return (await response.json()) as Pair;
}

async function listedVersion(deviceId: string) {
  const admin = await pairingAdminAuth();
  const { devices } = (await (await listDevices(request("/api/v1/paired/devices", { auth: admin }))).json()) as { devices: { id: string; appVersion: string | null }[] };
  return devices.find((device) => device.id === deviceId)!.appVersion;
}

async function signedIn(token: string) {
  return (await currentSession(request("/api/v1/auth/session", { auth: bearer(token) }))).status === 200;
}

describe("the app version a paired device runs", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives an app before 2.0, which names no version, bare tokens and records none", async () => {
    const claim = await pairPhone(await pairingAdminAuth());
    expect(claim.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claim.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await listedVersion(claim.device.id)).toBeNull();

    const next = await refreshed(claim.refreshToken);
    expect(next.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await signedIn(next.token)).toBe(true);
    expect(await listedVersion(claim.device.id)).toBeNull();
    expect((await readSessionFromRequest(request("/api/v1/auth/session", { auth: bearer(next.token) })))?.appVersion).toBeNull();
  });

  it("carries the version an app names at pairing in its tokens, and records it on the device", async () => {
    const claim = await pairPhone(await pairingAdminAuth(), { appVersion: "2.1.0" });
    expect(deviceTokenAppVersion(claim.token)).toBe("2.1.0");
    expect(deviceTokenAppVersion(claim.refreshToken)).toBe("2.1.0");
    expect(await signedIn(claim.token)).toBe(true);
    expect(await listedVersion(claim.device.id)).toBe("2.1.0");
    // Each request names the app that sent it.
    expect((await readSessionFromRequest(request("/api/v1/auth/session", { auth: bearer(claim.token) })))?.appVersion).toBe("2.1.0");
  });

  it("moves the version on at refresh; a refresh that names none gets bare tokens, and the device keeps its last version", async () => {
    const claim = await pairPhone(await pairingAdminAuth(), { appVersion: "2.1.0" });
    const updated = await refreshed(claim.refreshToken, { appVersion: "2.2.0" });
    expect(deviceTokenAppVersion(updated.token)).toBe("2.2.0");
    expect(await signedIn(updated.token)).toBe(true);
    expect(await listedVersion(claim.device.id)).toBe("2.2.0");

    const silent = await refreshed(updated.refreshToken);
    expect(silent.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(silent.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await signedIn(silent.token)).toBe(true);
    expect(await listedVersion(claim.device.id)).toBe("2.2.0");
  });

  it("gives an app that starts naming its version, as an updated 1.4 app does, tokens that carry it", async () => {
    const claim = await pairPhone(await pairingAdminAuth());
    const updated = await refreshed(claim.refreshToken, { appVersion: "2.1.0" });
    expect(deviceTokenAppVersion(updated.token)).toBe("2.1.0");
    expect(await listedVersion(claim.device.id)).toBe("2.1.0");
  });

  it("reads the X.Y marketing version the apps ship with", async () => {
    const claim = await pairPhone(await pairingAdminAuth(), { appVersion: "2.0" });
    expect(deviceTokenAppVersion(claim.token)).toBe("2.0");
    expect(await listedVersion(claim.device.id)).toBe("2.0");
    const next = await refreshed(claim.refreshToken, { appVersion: "2.1" });
    expect(deviceTokenAppVersion(next.token)).toBe("2.1");
  });

  it("ignores a version it can't read, at pairing and at refresh, rather than refusing either", async () => {
    const admin = await pairingAdminAuth();
    const issued = await issuedInvite(await invitePhoneRequest(admin, { endpointId: (await homeRoute()).id }));
    const claimed = await claimInvite(issued, "iPhone", {}, { appVersion: "latest" });
    expect(claimed.status).toBe(200);
    const claim = (await claimed.json()) as Pair & { device: { id: string } };
    expect(claim.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await listedVersion(claim.device.id)).toBeNull();

    const next = await refreshed(claim.refreshToken, { appVersion: 21 });
    expect(next.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await signedIn(next.token)).toBe(true);
  });

  it("gives a Watch the version of the app that set it up", async () => {
    const claim = await pairPhone(await pairingAdminAuth(), { appVersion: "2.1.0" });
    const response = await claimWatchRequest(bearer(claim.token));
    expect(response.status).toBe(201);
    const watch = (await response.json()) as Pair & { device: { id: string } };
    expect(deviceTokenAppVersion(watch.token)).toBe("2.1.0");
    expect(await listedVersion(watch.device.id)).toBe("2.1.0");
    // The Watch refreshes on its own, naming no version, and its tokens still carry its app's.
    const renewed = await refreshed(watch.refreshToken);
    expect(deviceTokenAppVersion(renewed.token)).toBe("2.1.0");
    expect(await listedVersion(watch.device.id)).toBe("2.1.0");

    const fromOld = await pairPhone(await pairingAdminAuth(), { displayName: "Old iPhone" });
    const oldWatch = (await (await claimWatchRequest(bearer(fromOld.token), { clientId: "0b0c6d8e-2a3f-4a5b-9c7d-1e2f3a4b5c6d" })).json()) as Pair & { device: { id: string } };
    expect(oldWatch.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await listedVersion(oldWatch.device.id)).toBeNull();
  });
});
