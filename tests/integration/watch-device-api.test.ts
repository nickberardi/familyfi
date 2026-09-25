import { beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind, PairedDeviceClient, SessionKind } from "@prisma/client";
import { createSession } from "@/server/auth";
import { authenticatePairedDevice } from "@/server/connection";
import { prisma } from "@/server/db";
import { POST as enroll, GET as listDevices } from "@/app/api/v1/connection/devices/route";
import { DELETE as revokeDevice } from "@/app/api/v1/connection/devices/[id]/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as listGroups } from "@/app/api/v1/groups/route";
import { GET as household } from "@/app/api/v1/settings/household/route";
import { POST as pause } from "@/app/api/v1/groups/[id]/pause/route";
import { POST as resume } from "@/app/api/v1/groups/[id]/resume/route";
import { POST as extend } from "@/app/api/v1/groups/[id]/extend/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const watchId = "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1";
type Auth = { cookie: string; csrf: string; token?: string };
type Enrollment = { deviceId: string; deviceCredential: string; sessionId: string; token: string; expiresAt: string };

async function pairedPhone() {
  const account = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
  const device = await prisma().pairedDevice.create({
    data: { displayName: "Parent's iPhone", credentialHash: "test-phone-credential" },
  });
  const session = await createSession({
    accountId: account.id, username: account.username, kind: SessionKind.bearer, deviceId: device.id,
  });
  return { device, auth: { cookie: "", csrf: "", token: session.raw } };
}

function enrollRequest(auth: Auth, clientId = watchId, client = "watch") {
  return enroll(request("/api/v1/connection/devices", {
    method: "POST", auth, headers: { "content-type": "application/json" },
    body: JSON.stringify({ client, clientId, displayName: "Kitchen Watch" }),
  }));
}

async function enrolledWatch(auth: Auth, clientId = watchId): Promise<Enrollment> {
  const response = await enrollRequest(auth, clientId);
  expect(response.status).toBe(201);
  return response.json() as Promise<Enrollment>;
}

function bearer(token: string): Auth { return { cookie: "", csrf: "", token }; }

async function administrator(): Promise<Auth> {
  const response = await login(request("/api/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD }),
  }));
  return authFromLogin(response);
}

async function revoke(id: string, auth: Auth) {
  return revokeDevice(request(`/api/v1/connection/devices/${id}`, { method: "DELETE", auth }),
    { params: Promise.resolve({ id }) });
}

describe("independent Watch device", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("enrolls a separate device with its own credential, session, and restricted access", async () => {
    const phone = await pairedPhone();
    const watch = await enrolledWatch(phone.auth);
    expect(watch.token).not.toBe(phone.auth.token);
    expect(new Date(watch.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: watch.deviceId } });
    expect(device.client).toBe(PairedDeviceClient.watch);
    expect(device.clientId).toBe(watchId);
    expect(device.id).not.toBe(phone.device.id);
    expect((await authenticatePairedDevice(watch.deviceId, watch.deviceCredential))?.id).toBe(watch.deviceId);
    const session = await prisma().session.findUniqueOrThrow({ where: { id: watch.sessionId } });
    expect(session.deviceId).toBe(watch.deviceId);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(200);
    expect((await listGroups(request("/api/v1/groups", { auth: bearer(watch.token) }))).status).toBe(200);
    const denied = await household(request("/api/v1/settings/household", { auth: bearer(watch.token) }));
    expect(denied.status).toBe(401);
    expect((await denied.json() as { error: { code: string } }).error.code).toBe("watch_scope");
    const listed = await listDevices(request("/api/v1/connection/devices", { auth: await administrator() }));
    const devices = (await listed.json() as { devices: { id: string; client: string }[] }).devices;
    expect(devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: phone.device.id, client: "phone" }),
      expect.objectContaining({ id: watch.deviceId, client: "watch" }),
    ]));
  });

  it("keeps Watch access after phone sign-out or revocation, but revokes it as its own device", async () => {
    const phone = await pairedPhone();
    const watch = await enrolledWatch(phone.auth);
    expect((await logout(request("/api/v1/auth/logout", { method: "POST", auth: phone.auth }))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(200);
    const admin = await administrator();
    expect((await revoke(phone.device.id, admin)).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(200);
    expect((await revoke(watch.deviceId, admin)).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
    expect(await authenticatePairedDevice(watch.deviceId, watch.deviceCredential)).toBeNull();
  });

  it("re-pairing the same Watch retires its previous device and session", async () => {
    const phone = await pairedPhone();
    const previous = await enrolledWatch(phone.auth);
    const current = await enrolledWatch(phone.auth);
    expect(current.deviceId).not.toBe(previous.deviceId);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(previous.token) }))).status).toBe(401);
    expect(await authenticatePairedDevice(previous.deviceId, previous.deviceCredential)).toBeNull();
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(current.token) }))).status).toBe(200);
  });

  it("allows a Watch to revoke its own device but no other device", async () => {
    const phone = await pairedPhone();
    const watch = await enrolledWatch(phone.auth);
    expect((await revoke(phone.device.id, bearer(watch.token))).status).toBe(403);
    expect((await revoke(watch.deviceId, bearer(watch.token))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
    expect((await currentSession(request("/api/v1/auth/session", { auth: phone.auth }))).status).toBe(200);
  });

  it("only a signed-in paired phone can enroll a Watch", async () => {
    const phone = await pairedPhone();
    expect((await enrollRequest(await administrator())).status).toBe(403);
    expect((await enrollRequest(phone.auth, watchId, "phone")).status).toBe(400);
    const watch = await enrolledWatch(phone.auth);
    expect((await enrollRequest(bearer(watch.token))).status).toBe(401);
    expect((await enrollRequest(bearer("invalid"))).status).toBe(401);
  });

  it("expires the Watch session without affecting its device or the phone", async () => {
    const phone = await pairedPhone();
    const watch = await enrolledWatch(phone.auth);
    await prisma().session.update({ where: { id: watch.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
    expect((await currentSession(request("/api/v1/auth/session", { auth: phone.auth }))).status).toBe(200);
    expect((await authenticatePairedDevice(watch.deviceId, watch.deviceCredential))?.id).toBe(watch.deviceId);
  });

  it("allows three controls for a child group but refuses adult and protected groups", async () => {
    const phone = await pairedPhone();
    const watch = await enrolledWatch(phone.auth);
    const auth = bearer(watch.token);
    const child = await prisma().group.create({ data: { kind: GroupKind.family, name: "Child", familyRole: FamilyRole.child } });
    const adult = await prisma().group.create({ data: { kind: GroupKind.family, name: "Adult", familyRole: FamilyRole.adult } });
    const protectedGroup = await prisma().group.create({ data: { kind: GroupKind.things, name: "Protected", protected: true } });
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const path = (id: string, action: string) => `/api/v1/groups/${id}/${action}`;
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await pause(request(path(child.id, "pause"), {
      method: "POST", auth, headers: { "content-type": "application/json" }, body: JSON.stringify({ until }),
    }), ctx(child.id))).status).toBe(200);
    expect((await extend(request(path(child.id, "extend"), {
      method: "POST", auth, headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes: 30 }),
    }), ctx(child.id))).status).toBe(200);
    expect((await resume(request(path(child.id, "resume"), { method: "POST", auth }), ctx(child.id))).status).toBe(200);
    expect((await pause(request(path(adult.id, "pause"), { method: "POST", auth }), ctx(adult.id))).status).toBe(403);
    expect((await resume(request(path(adult.id, "resume"), { method: "POST", auth }), ctx(adult.id))).status).toBe(403);
    expect((await extend(request(path(adult.id, "extend"), {
      method: "POST", auth, headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes: 30 }),
    }), ctx(adult.id))).status).toBe(403);
    expect((await resume(request(path(protectedGroup.id, "resume"), { method: "POST", auth }), ctx(protectedGroup.id))).status).toBe(403);
  });
});
