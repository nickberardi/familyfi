import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AccountKind, SessionKind } from "@prisma/client";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { PUT as updateAccount } from "@/app/api/v1/accounts/[id]/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { DELETE as removeRevoked, GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { DELETE as revokeDevice, PATCH as updateDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimInvite, claimWatchRequest, homeRoute, invitePhoneRequest, issuedInvite, pairPhone, PAIRING_ADMIN, pairingAdminAuth, type Claim } from "../helpers/pairing";

const json = { "content-type": "application/json" };

type Listed = { id: string; client: string; scope: string; actsAs: { username: string } | null; parentDeviceId: string | null; revokedAt: string | null };

/** Signed in as a personal administrator: an agent acts as whoever connects it, and none acts as the recovery admin. */
const admin = pairingAdminAuth;

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
    expect(all.find((device) => device.id === watch.device.id)).toMatchObject({ client: "watch", scope: "rulesOnly", parentDeviceId: phone.device.id, actsAs: { username: PAIRING_ADMIN.username } });

    expect((await list(auth, "?client=agent")).map((device) => device.id)).toEqual([agent.device.id]);
    expect((await list(auth, "?client=phone&client=watch")).map((device) => device.id).sort()).toEqual([phone.device.id, watch.device.id].sort());

    expect((await revoke(agent.device.id, auth)).status).toBe(200);
    expect((await list(auth, "?status=active")).map((device) => device.id)).not.toContain(agent.device.id);
    expect((await list(auth, "?status=revoked")).map((device) => device.id)).toEqual([agent.device.id]);
    expect((await listDevices(request("/api/v1/paired/devices?client=tablet", { auth }))).status).toBe(400);
  });

  it("lets a phone set up several Watches, each listed under it", async () => {
    const auth = await admin();
    const phone = await pairPhone(auth);
    const first = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    const second = (await (await claimWatchRequest(bearer(phone.token), { clientId: "0f7b2c4e-2d7a-4b0e-9c1d-5a6e7f8091a2" })).json()) as Claim;
    expect(first.device.id).not.toBe(second.device.id);
    const watches = await list(bearer(phone.token), "?client=watch&status=active");
    expect(watches.map((device) => device.id).sort()).toEqual([first.device.id, second.device.id].sort());
    expect(watches.every((device) => device.parentDeviceId === phone.device.id)).toBe(true);
  });

  it("unpairs and removes an adult's devices, and cancels their invites, when they stop being an administrator", async () => {
    const auth = await admin();
    const adult = await prisma().account.create({ data: { username: "other", displayName: "Other", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("parent-password-1") } });
    const phone = await pairPhone(auth, { accountId: adult.id });
    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    const pending = await issuedInvite(await invitePhoneRequest(auth, { endpointId: (await homeRoute()).id, accountId: adult.id, displayName: "Spare" }));
    // Someone else's phone stays.
    const kept = await pairPhone(auth);

    const demoted = await updateAccount(request(`/api/v1/accounts/${adult.id}`, { method: "PUT", auth, headers: json, body: JSON.stringify({ isAdmin: false }) }), params(adult.id));
    expect(demoted.status).toBe(200);
    for (const token of [phone.token, watch.token]) expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(token) }))).status).toBe(401);
    expect(await prisma().pairedDevice.count({ where: { id: { in: [phone.device.id, watch.device.id] } } })).toBe(0);
    expect((await claimInvite(pending, "Spare")).status).not.toBe(200);
    expect((await list(auth)).map((device) => device.id)).toEqual([kept.device.id]);
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

  it("revokes a phone's Watches with it", async () => {
    const { auth, phone, watch } = await household();
    expect((await revoke(phone.device.id, auth)).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
    expect((await list(auth, "?status=revoked")).map((device) => device.id).sort()).toEqual([phone.device.id, watch.device.id].sort());
  });

  it("revokes a phone's Watches when an administrator removes its record", async () => {
    const { auth, phone, watch } = await household();
    const removed = await revokeDevice(request(`/api/v1/paired/devices/${phone.device.id}?remove=true`, { method: "DELETE", auth }), params(phone.device.id));
    expect(removed.status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
  });

  it("revokes the Watches of a phone that unpairs itself", async () => {
    const { phone, watch } = await household();
    expect((await revoke(phone.device.id, bearer(phone.token))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(401);
  });

  it("clears revoked records in bulk and leaves active ones", async () => {
    const { auth, phone, agent } = await household();
    expect((await revoke(agent.device.id, auth)).status).toBe(200);
    expect((await removeRevoked(request("/api/v1/paired/devices", { method: "DELETE", auth }))).status).toBe(400);
    const removed = await removeRevoked(request("/api/v1/paired/devices?status=revoked", { method: "DELETE", auth }));
    expect(((await removed.json()) as { removed: number }).removed).toBe(1);
    expect((await list(auth)).map((device) => device.id)).toContain(phone.device.id);
  });

  it("revokes everything a phone paired, and everything those paired, with it", async () => {
    const auth = await admin();
    const phone = await pairPhone(auth);
    const endpointId = (await homeRoute()).id;
    // The phone pairs a second phone, which pairs an agent and its own Watch, and leaves an invite waiting.
    const second = (await (await claimInvite(await issuedInvite(await invitePhoneRequest(bearer(phone.token), { endpointId, displayName: "iPad" })), "iPad")).json()) as Claim;
    const watch = (await (await claimWatchRequest(bearer(second.token))).json()) as Claim;
    const agentCode = await issuedInvite(await createInvite(request("/api/v1/paired/invites", { method: "POST", auth: bearer(second.token), headers: json, body: JSON.stringify({ client: "agent", displayName: "Agent", scope: "readOnly" }) })));
    const agent = (await (await claimInvite(agentCode, "Agent")).json()) as Claim;
    const pending = await issuedInvite(await invitePhoneRequest(bearer(second.token), { endpointId, displayName: "Spare" }));
    // A phone paired from the browser is nobody's companion, and stays.
    const kept = await pairPhone(auth, { displayName: "Kitchen" });

    const listed = await list(auth);
    expect(listed.find((device) => device.id === second.device.id)?.parentDeviceId).toBe(phone.device.id);
    expect(listed.find((device) => device.id === agent.device.id)?.parentDeviceId).toBe(second.device.id);

    expect((await revoke(phone.device.id, auth)).status).toBe(200);
    for (const token of [second.token, watch.token, agent.token]) expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(token) }))).status).toBe(401);
    expect((await claimInvite(pending, "Spare")).status).toBe(403);
    expect((await list(auth, "?status=active")).map((device) => device.id)).toEqual([kept.device.id]);
  });

  it("keeps a phone it re-pairs, which takes the old record's place", async () => {
    const auth = await admin();
    const phone = await pairPhone(auth);
    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    const endpointId = (await homeRoute()).id;
    const repaired = (await (await claimInvite(await issuedInvite(await invitePhoneRequest(bearer(phone.token), { endpointId, replacesDeviceId: phone.device.id })))).json()) as Claim;

    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(repaired.token) }))).status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(watch.token) }))).status).toBe(200);
    const listed = await list(auth, "?status=active");
    expect(listed.find((device) => device.id === repaired.device.id)?.parentDeviceId).toBeNull();
    expect(listed.find((device) => device.id === watch.device.id)?.parentDeviceId).toBe(repaired.device.id);
  });

  it("revokes on upgrade every device paired as the recovery admin, and cancels its waiting invites", async () => {
    const auth = await admin();
    const kept = await pairPhone(auth);
    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    // Paired before the rule: a phone and its Watch acting as the recovery admin, and an invite still waiting.
    const phone = await prisma().pairedDevice.create({ data: { displayName: "Old iPhone", accountId: recovery.id } });
    const watch = await prisma().pairedDevice.create({ data: { displayName: "Old Watch", client: "watch", scope: "rulesOnly", accountId: recovery.id, parentDeviceId: phone.id } });
    for (const device of [phone, watch]) await createSession({ accountId: recovery.id, username: recovery.username, kind: SessionKind.bearer, deviceId: device.id });
    const sessionIds = (await prisma().session.findMany({ where: { deviceId: { in: [phone.id, watch.id] } } })).map((session) => session.id);
    const waiting = await prisma().pairing.create({ data: { client: "phone", scope: "full", displayName: "Spare", accountId: recovery.id, createdByAccountId: recovery.id, tokenHash: "unused", expiresAt: new Date(Date.now() + 60_000) } });

    const sql = readFileSync(path.join(__dirname, "../../prisma/migrations/20261026170000_no_devices_as_recovery/migration.sql"), "utf8");
    for (const statement of sql.split(/;\s*$/m).map((part) => part.replace(/^--.*$/gm, "").trim()).filter(Boolean)) await prisma().$executeRawUnsafe(statement);

    expect(await prisma().pairedDevice.count({ where: { id: { in: [phone.id, watch.id] }, revokedAt: null } })).toBe(0);
    expect(sessionIds).toHaveLength(2);
    expect(await prisma().session.count({ where: { id: { in: sessionIds }, revokedAt: null } })).toBe(0);
    expect((await prisma().pairing.findUniqueOrThrow({ where: { id: waiting.id } })).expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await list(auth, "?status=active")).map((device) => device.id)).toEqual([kept.device.id]);
  });
});
