import { beforeEach, describe, expect, it } from "vitest";
import { AccountKind, DeviceScope, PairedDeviceClient } from "@prisma/client";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { DELETE as cancelInvite, GET as inviteStatus } from "@/app/api/v1/paired/invites/[id]/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimInvite, claimWatchRequest, homeRoute, invitePhoneRequest, issuedInvite, pairPhone, type Claim } from "../helpers/pairing";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const json = { "content-type": "application/json" };

async function admin(): Promise<SessionAuth> {
  return authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) })));
}

async function adult(username: string, isAdmin = true) {
  return prisma().account.create({ data: { username, displayName: username, kind: AccountKind.personal, isAdmin, passwordHash: await hashPassword("adult-password-1") } });
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /paired/invites", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("pairs a phone without a password: the claim signs it in and carries its route and manifest", async () => {
    const claim = await pairPhone(await admin());
    expect(claim).not.toHaveProperty("deviceCredential");
    expect(claim.device).toMatchObject({ client: "phone", scope: "full" });
    expect(claim.session.username).toBe("admin");
    expect(claim.connection?.endpoint?.url).toBe("https://familyfi.local");
    expect(claim.connection?.manifest.signature).toBeTruthy();
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claim.token) }))).status).toBe(200);
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } });
    expect(device.accountId).toBe((await prisma().account.findUniqueOrThrow({ where: { username: "admin" } })).id);
  });

  it("signs a phone in as the adult the administrator chose", async () => {
    const parent = await adult("parent");
    const claim = await pairPhone(await admin(), { accountId: parent.id });
    expect(claim.session.username).toBe("parent");
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } })).accountId).toBe(parent.id);

    const route = await homeRoute();
    const unknown = await invitePhoneRequest(await admin(), { endpointId: route.id, accountId: "missing-account" });
    expect(unknown.status).toBe(404);
  });

  it("uses a code once, refuses a cancelled or expired one, and reports status", async () => {
    const auth = await admin();
    const route = await homeRoute();
    const issued = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id }));
    expect(((await (await inviteStatus(request(`/api/v1/paired/invites/${issued.id}`, { auth }), params(issued.id))).json()) as { invite: { status: string } }).invite.status).toBe("pending");
    expect((await claimInvite(issued)).status).toBe(200);
    expect(await errorCode(await claimInvite(issued))).toBe("invalid_pairing");
    expect(((await (await inviteStatus(request(`/api/v1/paired/invites/${issued.id}`, { auth }), params(issued.id))).json()) as { invite: { status: string } }).invite.status).toBe("claimed");

    const cancelled = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id }));
    expect((await cancelInvite(request(`/api/v1/paired/invites/${cancelled.id}`, { method: "DELETE", auth }), params(cancelled.id))).status).toBe(200);
    expect((await claimInvite(cancelled)).status).toBe(403);

    const expired = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id }));
    await prisma().pairing.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await claimInvite(expired)).status).toBe(403);
  });

  it("re-pairs a phone, removing the record it replaces", async () => {
    const auth = await admin();
    const old = await pairPhone(auth);
    const route = await homeRoute();
    const issued = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id, replacesDeviceId: old.device.id }));
    const watch = (await (await claimWatchRequest(bearer(old.token))).json()) as Claim;
    const replacement = (await (await claimInvite(issued)).json()) as Claim;
    expect(await prisma().pairedDevice.findUnique({ where: { id: old.device.id } })).toBeNull();
    // The new phone keeps the old one's Watch.
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: watch.device.id } })).parentDeviceId).toBe(replacement.device.id);
  });

  it("lets a phone invite and claim its Watch at once, as the phone's account and its parent", async () => {
    const parent = await adult("parent");
    const phone = await pairPhone(await admin(), { accountId: parent.id });
    const response = await claimWatchRequest(bearer(phone.token), { displayName: "Kitchen Watch" });
    expect(response.status).toBe(201);
    const watch = (await response.json()) as Claim & { invite: { status: string } };
    expect(watch.invite.status).toBe("claimed");
    expect(watch.device).toMatchObject({ client: "watch", scope: "rulesOnly", displayName: "Kitchen Watch" });
    expect(watch.session.username).toBe("parent");
    expect(watch.connection?.manifest).toBeTruthy();
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: watch.device.id } });
    expect(device).toMatchObject({ client: PairedDeviceClient.watch, scope: DeviceScope.rulesOnly, parentDeviceId: phone.device.id, accountId: parent.id });
  });

  it("serves claim=true only to a paired phone, and only for a Watch", async () => {
    const auth = await admin();
    const phone = await pairPhone(auth);
    // An administrator's browser never receives another device's tokens.
    const browser = await claimWatchRequest(auth);
    expect(browser.status).toBe(403);
    expect(await errorCode(browser)).toBe("paired_phone_required");
    expect((await claimWatchRequest(bearer(phone.token), { client: "phone" })).status).toBe(400);

    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    expect(await errorCode(await claimWatchRequest(bearer(watch.token)))).toBe("watch_scope");

    const agentInvite = await issuedInvite(await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "agent", displayName: "Agent", scope: "full" }) })));
    const agent = (await (await claimInvite(agentInvite, "Agent")).json()) as Claim;
    expect(await errorCode(await claimWatchRequest(bearer(agent.token)))).toBe("agent_scope");
  });

  it("asks a Watch to be invited by its phone, and a phone for its route", async () => {
    const auth = await admin();
    const watchByAdmin = await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "watch", clientId: "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1" }) }));
    expect(watchByAdmin.status).toBe(400);
    expect((await invitePhoneRequest(auth, {})).status).toBe(400);
    expect((await invitePhoneRequest(auth, { endpointId: "missing-route" })).status).toBe(404);
  });

  it("pairs a phone only as an administrator, since only administrators have paired phones", async () => {
    const auth = await admin();
    const member = await adult("member", false);
    const route = await homeRoute();
    const refused = await invitePhoneRequest(auth, { endpointId: route.id, accountId: member.id });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("administrator_account_required");
  });

  it("voids an invite for an adult who has since stopped being an administrator", async () => {
    const auth = await admin();
    const parent = await adult("parent");
    const route = await homeRoute();
    const invite = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id, accountId: parent.id }));
    // Demoted behind the API's back, so the invite was not cancelled: the claim refuses it anyway.
    await prisma().account.update({ where: { id: parent.id }, data: { isAdmin: false } });
    const refused = await claimInvite(invite, "iPhone");
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("invalid_pairing");
    expect(await prisma().pairedDevice.count({ where: { accountId: parent.id } })).toBe(0);
  });
});
