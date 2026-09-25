import { beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind, SessionKind } from "@prisma/client";
import { createSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST as issueWatch } from "@/app/api/v1/connection/devices/[id]/sessions/route";
import { DELETE as revokeWatch } from "@/app/api/v1/connection/devices/[id]/sessions/[sessionId]/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as listGroups } from "@/app/api/v1/groups/route";
import { GET as household } from "@/app/api/v1/settings/household/route";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { DELETE as revokePhone } from "@/app/api/v1/connection/devices/[id]/route";
import { POST as pause } from "@/app/api/v1/groups/[id]/pause/route";
import { POST as resume } from "@/app/api/v1/groups/[id]/resume/route";
import { POST as extend } from "@/app/api/v1/groups/[id]/extend/route";

const watchId = "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1";

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

async function issue(auth: { cookie: string; csrf: string; token?: string }, deviceId: string, clientId = watchId) {
  return issueWatch(request(`/api/v1/connection/devices/${deviceId}/sessions`, {
    method: "POST", auth, headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "watch", clientId }),
  }), { params: Promise.resolve({ id: deviceId }) });
}

describe("Watch sessions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("issues a distinct scoped token and replaces the active Watch session", async () => {
    const phone = await pairedPhone();
    const issued = await issue(phone.auth, phone.device.id);
    expect(issued.status).toBe(201);
    const first = await issued.json() as { sessionId: string; token: string; expiresAt: string };
    expect(first.token).not.toBe(phone.auth.token);
    expect(new Date(first.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    const watchAuth = { cookie: "", csrf: "", token: first.token };
    expect((await currentSession(request("/api/v1/auth/session", { auth: watchAuth }))).status).toBe(200);
    expect((await listGroups(request("/api/v1/groups", { auth: watchAuth }))).status).toBe(200);
    const denied = await household(request("/api/v1/settings/household", { auth: watchAuth }));
    expect(denied.status).toBe(401);
    expect((await denied.json() as { error: { code: string } }).error.code).toBe("watch_scope");
    expect((await issue(watchAuth, phone.device.id)).status).toBe(401);

    const replacement = await issue(phone.auth, phone.device.id, "7ea4417c-9157-484c-9903-97adf240715f");
    expect(replacement.status).toBe(201);
    expect((await currentSession(request("/api/v1/auth/session", { auth: watchAuth }))).status).toBe(401);
    const second = await replacement.json() as { token: string };
    expect((await currentSession(request("/api/v1/auth/session", { auth: { ...watchAuth, token: second.token } }))).status).toBe(200);
  });

  it("revokes Watch access alone, and revokes a replacement on phone sign-out", async () => {
    const phone = await pairedPhone();
    const first = await (await issue(phone.auth, phone.device.id)).json() as { sessionId: string; token: string };
    const deleted = await revokeWatch(
      request(`/api/v1/connection/devices/${phone.device.id}/sessions/${first.sessionId}`, { method: "DELETE", auth: phone.auth }),
      { params: Promise.resolve({ id: phone.device.id, sessionId: first.sessionId }) },
    );
    expect(deleted.status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: { cookie: "", csrf: "", token: first.token } }))).status).toBe(401);
    expect((await currentSession(request("/api/v1/auth/session", { auth: phone.auth }))).status).toBe(200);

    const second = await (await issue(phone.auth, phone.device.id)).json() as { token: string };
    expect((await logout(request("/api/v1/auth/logout", { method: "POST", auth: phone.auth }))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: { cookie: "", csrf: "", token: second.token } }))).status).toBe(401);
  });

  it("allows an administrator to revoke Watch access and rejects browser provisioning", async () => {
    const phone = await pairedPhone();
    const first = await (await issue(phone.auth, phone.device.id)).json() as { sessionId: string; token: string };
    const loginResponse = await login(request("/api/v1/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD }),
    }));
    const admin = authFromLogin(loginResponse);
    expect((await issue(admin, phone.device.id)).status).toBe(403);
    expect((await revokeWatch(
      request(`/api/v1/connection/devices/${phone.device.id}/sessions/${first.sessionId}`, { method: "DELETE", auth: admin }),
      { params: Promise.resolve({ id: phone.device.id, sessionId: first.sessionId }) },
    )).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: { cookie: "", csrf: "", token: first.token } }))).status).toBe(401);
  });

  it("binds issuance and revocation to the paired phone in the path", async () => {
    const phone = await pairedPhone();
    const other = await prisma().pairedDevice.create({
      data: { displayName: "Other phone", credentialHash: "other-phone-credential" },
    });
    expect((await issue(phone.auth, other.id)).status).toBe(403);
    const invalidClient = await issueWatch(request(`/api/v1/connection/devices/${phone.device.id}/sessions`, {
      method: "POST", auth: phone.auth, headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: "phone", clientId: watchId }),
    }), { params: Promise.resolve({ id: phone.device.id }) });
    expect(invalidClient.status).toBe(400);

    const issued = await (await issue(phone.auth, phone.device.id)).json() as { sessionId: string; token: string };
    const wrongDevice = await revokeWatch(
      request(`/api/v1/connection/devices/${other.id}/sessions/${issued.sessionId}`, { method: "DELETE", auth: phone.auth }),
      { params: Promise.resolve({ id: other.id, sessionId: issued.sessionId }) },
    );
    expect(wrongDevice.status).toBe(404);
    expect((await currentSession(request("/api/v1/auth/session", {
      auth: { cookie: "", csrf: "", token: issued.token },
    }))).status).toBe(200);
  });

  it("expires Watch access and ends it when the paired phone is revoked", async () => {
    const phone = await pairedPhone();
    const first = await (await issue(phone.auth, phone.device.id)).json() as { sessionId: string; token: string };
    await prisma().session.update({
      where: { id: first.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await currentSession(request("/api/v1/auth/session", {
      auth: { cookie: "", csrf: "", token: first.token },
    }))).status).toBe(401);

    const second = await (await issue(phone.auth, phone.device.id)).json() as { token: string };
    const loginResponse = await login(request("/api/v1/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD }),
    }));
    const admin = authFromLogin(loginResponse);
    const revoked = await revokePhone(
      request(`/api/v1/connection/devices/${phone.device.id}`, { method: "DELETE", auth: admin }),
      { params: Promise.resolve({ id: phone.device.id }) },
    );
    expect(revoked.status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", {
      auth: { cookie: "", csrf: "", token: second.token },
    }))).status).toBe(401);
  });

  it("allows the three controls for a child group but refuses adult and protected groups", async () => {
    const phone = await pairedPhone();
    const issued = await (await issue(phone.auth, phone.device.id)).json() as { token: string };
    const auth = { cookie: "", csrf: "", token: issued.token };
    const child = await prisma().group.create({
      data: { kind: GroupKind.family, name: "Child", familyRole: FamilyRole.child },
    });
    const adult = await prisma().group.create({
      data: { kind: GroupKind.family, name: "Adult", familyRole: FamilyRole.adult },
    });
    const protectedGroup = await prisma().group.create({
      data: { kind: GroupKind.things, name: "Protected", protected: true },
    });
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const path = (id: string, action: string) => `/api/v1/groups/${id}/${action}`;
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await pause(request(path(child.id, "pause"), {
      method: "POST", auth, headers: { "content-type": "application/json" },
      body: JSON.stringify({ until }),
    }), ctx(child.id))).status).toBe(200);
    expect((await extend(request(path(child.id, "extend"), {
      method: "POST", auth, headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 30 }),
    }), ctx(child.id))).status).toBe(200);
    expect((await resume(request(path(child.id, "resume"), {
      method: "POST", auth,
    }), ctx(child.id))).status).toBe(200);
    expect((await pause(request(path(adult.id, "pause"), {
      method: "POST", auth,
    }), ctx(adult.id))).status).toBe(403);
    expect((await resume(request(path(adult.id, "resume"), {
      method: "POST", auth,
    }), ctx(adult.id))).status).toBe(403);
    expect((await extend(request(path(adult.id, "extend"), {
      method: "POST", auth, headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 30 }),
    }), ctx(adult.id))).status).toBe(403);
    expect((await resume(request(path(protectedGroup.id, "resume"), {
      method: "POST", auth,
    }), ctx(protectedGroup.id))).status).toBe(403);
  });
});
