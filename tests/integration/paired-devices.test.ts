import { beforeEach, describe, expect, it } from "vitest";
import { AccountKind } from "@prisma/client";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { DELETE as removeRevoked, GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { DELETE as revokeDevice, GET as getDevice, PATCH as updateDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimInvite, claimWatchRequest, issuedInvite, pairPhone, type Claim } from "../helpers/pairing";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const json = { "content-type": "application/json" };

type Listed = { id: string; client: string; scope: string; actsAs: { username: string } | null; parentDeviceId: string | null; revokedAt: string | null };

async function admin(): Promise<SessionAuth> {
  return authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) })));
}

async function list(auth: SessionAuth, query = "") {
  const response = await listDevices(request(`/api/v1/paired/devices${query}`, { auth }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { devices: Listed[] }).devices;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function revoke(id: string, auth: SessionAuth, query = "") {
  return revokeDevice(request(`/api/v1/paired/devices/${id}${query}`, { method: "DELETE", auth }), params(id));
}

/** A household with a phone, its Watch, and an agent. */
async function household() {
  const auth = await admin();
  const phone = await pairPhone(auth);
  const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
  const agentInvite = await issuedInvite(await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "agent", displayName: "Agent", scope: "readOnly" }) })));
  const agent = (await (await claimInvite(agentInvite, "Agent")).json()) as Claim;
  return { auth, phone, watch, agent };
}

describe("/paired/devices", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists by client and status, with who each acts as and its parent", async () => {
    const { auth, phone, watch, agent } = await household();
    const all = await list(auth);
    expect(all.map((device) => device.id).sort()).toEqual([phone.device.id, watch.device.id, agent.device.id].sort());
    expect(all.find((device) => device.id === watch.device.id)).toMatchObject({ client: "watch", scope: "rulesOnly", parentDeviceId: phone.device.id, actsAs: { username: "admin" } });

    expect((await list(auth, "?client=agent")).map((device) => device.id)).toEqual([agent.device.id]);
    expect((await list(auth, "?client=phone&client=watch")).map((device) => device.id).sort()).toEqual([phone.device.id, watch.device.id].sort());

    expect((await revoke(agent.device.id, auth)).status).toBe(200);
    expect((await list(auth, "?status=active")).map((device) => device.id)).not.toContain(agent.device.id);
    expect((await list(auth, "?status=revoked")).map((device) => device.id)).toEqual([agent.device.id]);
    expect((await listDevices(request("/api/v1/paired/devices?client=tablet", { auth }))).status).toBe(400);
  });

  it("shows a phone of an adult who is not an administrator only itself and its Watch", async () => {
    const auth = await admin();
    const member = await prisma().account.create({ data: { username: "member", displayName: "Member", kind: AccountKind.personal, isAdmin: false, passwordHash: await hashPassword("member-password-1") } });
    await pairPhone(auth, { displayName: "Someone else's phone" });
    const phone = await pairPhone(auth, { accountId: member.id, displayName: "Member's phone" });
    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    expect((await list(bearer(phone.token))).map((device) => device.id).sort()).toEqual([phone.device.id, watch.device.id].sort());
    expect((await getDevice(request(`/api/v1/paired/devices/${watch.device.id}`, { auth: bearer(phone.token) }), params(watch.device.id))).status).toBe(200);
  });

  it("renames a device and changes an agent's scope, but only to a scope its kind may hold", async () => {
    const { auth, phone, agent } = await household();
    const patch = (id: string, body: unknown) => updateDevice(request(`/api/v1/paired/devices/${id}`, { method: "PATCH", auth, headers: json, body: JSON.stringify(body) }), params(id));
    const renamed = await patch(phone.device.id, { displayName: "Kitchen iPhone" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { device: { displayName: string } }).device.displayName).toBe("Kitchen iPhone");

    const widened = await patch(agent.device.id, { scope: "full" });
    expect(((await widened.json()) as { device: { scope: string } }).device.scope).toBe("full");
    const invalid = await patch(agent.device.id, { scope: "rulesOnly" });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe("invalid_scope");
    expect((await patch(phone.device.id, { scope: "readOnly" })).status).toBe(400);
    expect((await patch(phone.device.id, {})).status).toBe(400);
  });

  it("revokes by an administrator, by the device itself, or by its parent; removing is for administrators", async () => {
    const { auth, phone, watch, agent } = await household();
    // The Watch cannot revoke its phone; the phone, its parent, can revoke the Watch.
    expect((await revoke(phone.device.id, bearer(watch.token))).status).toBe(403);
    expect((await revoke(watch.device.id, bearer(phone.token))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);

    expect((await revoke(agent.device.id, bearer(agent.token))).status).toBe(200);
    expect((await revoke(agent.device.id, bearer(phone.token), "?remove=true")).status).toBe(200);
    expect(await prisma().pairedDevice.findUnique({ where: { id: agent.device.id } })).toBeNull();
    expect((await revoke(phone.device.id, auth)).status).toBe(200);
  });

  it("leaves a Watch working when its phone is revoked", async () => {
    const { auth, phone, watch } = await household();
    expect((await revoke(phone.device.id, auth)).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(200);
  });

  it("clears revoked records in bulk and leaves active ones", async () => {
    const { auth, phone, agent } = await household();
    expect((await revoke(agent.device.id, auth)).status).toBe(200);
    expect((await removeRevoked(request("/api/v1/paired/devices", { method: "DELETE", auth }))).status).toBe(400);
    const removed = await removeRevoked(request("/api/v1/paired/devices?status=revoked", { method: "DELETE", auth }));
    expect(((await removed.json()) as { removed: number }).removed).toBe(1);
    expect((await list(auth)).map((device) => device.id)).toContain(phone.device.id);
  });
});
