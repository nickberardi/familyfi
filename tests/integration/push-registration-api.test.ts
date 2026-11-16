import { randomBytes } from "node:crypto";
import { AccountKind } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { PUT as updateAccount } from "@/app/api/v1/accounts/[id]/route";
import { GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { DELETE as revokeDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { DELETE as removePush, PUT as registerPush } from "@/app/api/v1/paired/devices/[id]/push/route";
import { GET as getAlerts, PUT as setAlerts } from "@/app/api/v1/paired/devices/[id]/alerts/route";
import { request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimWatchRequest, pairingAdminAuth, pairPhone, type Claim } from "../helpers/pairing";

const json = { "content-type": "application/json" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const KEY = randomBytes(32).toString("base64");
const TOKEN = "a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1c2d3e4f5a0b1";

const registration = (overrides: Record<string, unknown> = {}) => ({
  platform: "ios",
  channel: "release",
  token: TOKEN,
  key: KEY,
  format: 1,
  kinds: ["device.new", "sync.down", "sync.up"],
  ...overrides,
});

function register(id: string, auth: SessionAuth, body: unknown = registration()) {
  return registerPush(request(`/api/v1/paired/devices/${id}/push`, { method: "PUT", auth, headers: json, body: JSON.stringify(body) }), params(id));
}

function unregister(id: string, auth: SessionAuth) {
  return removePush(request(`/api/v1/paired/devices/${id}/push`, { method: "DELETE", auth }), params(id));
}

function choices(id: string, auth: SessionAuth) {
  return getAlerts(request(`/api/v1/paired/devices/${id}/alerts`, { auth }), params(id));
}

function choose(id: string, auth: SessionAuth, kinds: Record<string, boolean>) {
  return setAlerts(request(`/api/v1/paired/devices/${id}/alerts`, { method: "PUT", auth, headers: json, body: JSON.stringify({ kinds }) }), params(id));
}

async function codeOf(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("/paired/devices/{id}/push and /alerts", () => {
  let admin: SessionAuth;
  let phone: Claim;

  beforeEach(async () => {
    await resetDatabase();
    admin = await pairingAdminAuth();
    phone = await pairPhone(admin);
  });

  it("stores a phone's own token and key encrypted, and never returns them", async () => {
    const response = await register(phone.device.id, bearer(phone.token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alerts: { kinds: { "device.new": true, "sync.down": true, "sync.up": true } } });

    const stored = await prisma().pushRegistration.findUniqueOrThrow({ where: { deviceId: phone.device.id } });
    expect(stored).toMatchObject({ platform: "ios", channel: "release", format: 1 });
    const columns = Buffer.concat([stored.tokenCiphertext, stored.keyCiphertext]).toString("latin1");
    expect(columns).not.toContain(TOKEN);
    expect(columns).not.toContain(Buffer.from(KEY, "base64").toString("latin1"));

    const listed = await listDevices(request("/api/v1/paired/devices", { auth: admin }));
    const text = await listed.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(KEY);
    const devices = (JSON.parse(text) as { devices: { id: string; alerts?: boolean }[] }).devices;
    expect(devices.find((device) => device.id === phone.device.id)?.alerts).toBe(true);
  });

  it("refuses everyone but the app on that device", async () => {
    const other = await pairPhone(admin, { displayName: "iPad" });
    expect((await register(phone.device.id, bearer(other.token))).status).toBe(403);
    const browser = await register(phone.device.id, admin);
    expect(browser.status).toBe(403);
    expect(await codeOf(browser)).toBe("own_device_required");
    expect(await codeOf(await choices(phone.device.id, admin))).toBe("own_device_required");

    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    const fromWatch = await register(watch.device.id, bearer(watch.token));
    expect(fromWatch.status).toBe(403);
    expect(await codeOf(fromWatch)).toBe("watch_scope");

    expect((await register("missing", bearer(phone.token))).status).toBe(404);
    expect(await prisma().pushRegistration.count()).toBe(0);
  });

  it("refuses a key that is not 32 bytes, and drops kinds it does not know", async () => {
    const short = await register(phone.device.id, bearer(phone.token), registration({ key: randomBytes(16).toString("base64") }));
    expect(short.status).toBe(400);
    const urlSafe = randomBytes(32).toString("base64url");
    const response = await register(phone.device.id, bearer(phone.token), registration({ key: urlSafe, kinds: ["device.new", "pause.ending"] }));
    expect(await response.json()).toEqual({ alerts: { kinds: { "device.new": true } } });
  });

  it("turns kinds on and off, keeping them when the phone registers again", async () => {
    expect(await codeOf(await choices(phone.device.id, bearer(phone.token)))).toBe("push_not_registered");
    expect((await choose(phone.device.id, bearer(phone.token), { "device.new": false })).status).toBe(404);

    await register(phone.device.id, bearer(phone.token));
    const muted = await choose(phone.device.id, bearer(phone.token), { "device.new": false, "future.kind": true });
    expect(await muted.json()).toEqual({ alerts: { kinds: { "device.new": false, "sync.down": true, "sync.up": true } } });

    await register(phone.device.id, bearer(phone.token), registration({ token: "new-token" }));
    expect(await (await choices(phone.device.id, bearer(phone.token))).json()).toEqual({ alerts: { kinds: { "device.new": false, "sync.down": true, "sync.up": true } } });
    expect(await (await choose(phone.device.id, bearer(phone.token), { "device.new": true })).json()).toEqual({ alerts: { kinds: { "device.new": true, "sync.down": true, "sync.up": true } } });
  });

  it("forgets the registration when the phone turns alerts off, is revoked, or its account stops being an administrator", async () => {
    await register(phone.device.id, bearer(phone.token));
    expect((await unregister(phone.device.id, bearer(phone.token))).status).toBe(200);
    expect(await prisma().pushRegistration.count()).toBe(0);

    await register(phone.device.id, bearer(phone.token));
    await prisma().alertEvent.create({ data: { kind: "sync.down", deviceId: phone.device.id, detail: {}, dedupeKey: "k1" } });
    expect((await revokeDevice(request(`/api/v1/paired/devices/${phone.device.id}`, { method: "DELETE", auth: admin }), params(phone.device.id))).status).toBe(200);
    expect(await prisma().pushRegistration.count()).toBe(0);
    expect(await prisma().alertEvent.count()).toBe(0);

    const adult = await prisma().account.create({ data: { username: "other", displayName: "Other", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("parent-password-1") } });
    const theirs = await pairPhone(admin, { accountId: adult.id });
    await register(theirs.device.id, bearer(theirs.token));
    const demoted = await updateAccount(request(`/api/v1/accounts/${adult.id}`, { method: "PUT", auth: admin, headers: json, body: JSON.stringify({ isAdmin: false }) }), params(adult.id));
    expect(demoted.status).toBe(200);
    expect(await prisma().pushRegistration.count()).toBe(0);
  });

  it("revoking a phone forgets the registrations of the phones it paired", async () => {
    const child = await pairPhone(admin, { displayName: "iPad" });
    await prisma().pairedDevice.update({ where: { id: child.device.id }, data: { parentDeviceId: phone.device.id } });
    await register(child.device.id, bearer(child.token));
    expect((await revokeDevice(request(`/api/v1/paired/devices/${phone.device.id}`, { method: "DELETE", auth: admin }), params(phone.device.id))).status).toBe(200);
    expect(await prisma().pushRegistration.count()).toBe(0);
  });
});
