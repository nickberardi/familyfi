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
import { bearer, claimInvite, claimWatchRequest, homeRoute, invitePhoneRequest, issuedInvite, pairPhone, PAIRING_ADMIN, pairingAdminAuth, type Claim } from "../helpers/pairing";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";

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
    expect(claim.device).toMatchObject({ client: "app", scope: "full" });
    expect(claim.session.username).toBe(PAIRING_ADMIN.username);
    expect(claim.connection?.endpoint?.url).toBe("https://familyfi.local");
    expect(claim.connection?.manifest.signature).toBeTruthy();
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claim.token) }))).status).toBe(200);
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } });
    expect(device.accountId).toBe((await prisma().account.findUniqueOrThrow({ where: { username: PAIRING_ADMIN.username } })).id);
  });

  it("names a phone what the administrator typed when inviting it, not what the phone calls itself", async () => {
    const route = await homeRoute();
    const created = await invitePhoneRequest(await admin(), { endpointId: route.id, displayName: "Kitchen iPad" });
    const claimed = await claimInvite(await issuedInvite(created), "iPad");
    const claim = (await claimed.json()) as Claim;
    expect(claim.device.displayName).toBe("Kitchen iPad");
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } })).displayName).toBe("Kitchen iPad");
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

  it("revokes the replaced phone's Watch when the new phone acts as another account", async () => {
    const auth = await admin();
    const parent = await adult("parent");
    const old = await pairPhone(auth);
    const route = await homeRoute();
    const watch = (await (await claimWatchRequest(bearer(old.token))).json()) as Claim;
    const issued = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id, replacesDeviceId: old.device.id, accountId: parent.id }));
    const replacement = (await (await claimInvite(issued)).json()) as Claim;
    // A Watch acts as its phone's account, so it is not handed to a phone acting as someone else.
    const kept = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: watch.device.id } });
    expect(kept.parentDeviceId).not.toBe(replacement.device.id);
    expect(kept.revokedAt).not.toBeNull();
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

  it("lets an app set up its own rulesOnly sign-in for Siri and shortcuts, as its child, one per app", async () => {
    const parent = await adult("parent");
    const phone = await pairPhone(await admin(), { accountId: parent.id });
    const controls = { client: "app", scope: "rulesOnly", clientId: "0b1f6c0e-8f2e-4a55-9a0e-2f1f3f1c9d11" };
    const response = await claimWatchRequest(bearer(phone.token), { ...controls, displayName: "Siri and Shortcuts on Parent's iPhone" });
    expect(response.status).toBe(201);
    const claimed = (await response.json()) as Claim & { invite: { status: string } };
    expect(claimed.invite.status).toBe("claimed");
    expect(claimed.device).toMatchObject({ client: "app", scope: "rulesOnly", displayName: "Siri and Shortcuts on Parent's iPhone" });
    expect(claimed.session.username).toBe("parent");
    // It may work away from home, as its app does.
    expect(claimed.connection?.manifest).toBeTruthy();
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claimed.device.id } });
    expect(device).toMatchObject({ client: PairedDeviceClient.app, scope: DeviceScope.rulesOnly, parentDeviceId: phone.device.id, accountId: parent.id });

    // Its own tokens, bounded by its scope: it reads groups, and sets up nothing, though it is an `app`.
    const { GET: groups } = await import("@/app/api/v1/groups/route");
    expect((await groups(request("/api/v1/groups", { auth: bearer(claimed.token) }))).status).toBe(200);
    expect(await errorCode(await claimWatchRequest(bearer(claimed.token)))).toBe("app_scope");
    expect(await errorCode(await claimWatchRequest(bearer(claimed.token), controls))).toBe("app_scope");

    // Setting it up again replaces the record, so the app never has two.
    const again = (await (await claimWatchRequest(bearer(phone.token), controls)).json()) as Claim;
    expect(again.device.displayName).toBe("Shortcuts and controls");
    const mine = await prisma().pairedDevice.findMany({ where: { parentDeviceId: phone.device.id, scope: DeviceScope.rulesOnly, revokedAt: null } });
    expect(mine.map((row) => row.id)).toEqual([again.device.id]);
    expect((await groups(request("/api/v1/groups", { auth: bearer(claimed.token) }))).status).toBe(401);
  });

  it("ends an app's rulesOnly sign-in when the app is revoked", async () => {
    const phone = await pairPhone(await admin());
    const controls = (await (await claimWatchRequest(bearer(phone.token), { client: "app", scope: "rulesOnly" })).json()) as Claim;
    const { DELETE } = await import("@/app/api/v1/paired/devices/[id]/route");
    const revoked = await DELETE(request(`/api/v1/paired/devices/${phone.device.id}`, { method: "DELETE", auth: await admin() }), { params: Promise.resolve({ id: phone.device.id }) });
    expect(revoked.status).toBeLessThan(300);
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: controls.device.id } })).revokedAt).not.toBeNull();
  });

  it("claims an app this way only with the rulesOnly scope: never a second full app", async () => {
    const phone = await pairPhone(await admin());
    expect((await claimWatchRequest(bearer(phone.token), { client: "app" })).status).toBe(400);
    expect((await claimWatchRequest(bearer(phone.token), { client: "app", scope: "full" })).status).toBe(400);
  });

  it("still takes the deprecated phone for app in an invite, and answers app", async () => {
    const route = await homeRoute();
    const invited = await issuedInvite(await createInvite(request("/api/v1/paired/invites", { method: "POST", auth: await pairingAdminAuth(), headers: json, body: JSON.stringify({ client: "phone", displayName: "Old app's phone", endpointId: route.id }) })));
    const claim = (await (await claimInvite(invited, "iPhone")).json()) as Claim;
    expect(claim.device).toMatchObject({ client: "app", scope: "full" });
  });

  it("serves claim=true only to a paired phone, and only for a Watch or its own rulesOnly sign-in", async () => {
    const auth = await admin();
    const phone = await pairPhone(auth);
    // An administrator's browser never receives another device's tokens.
    const browser = await claimWatchRequest(auth);
    expect(browser.status).toBe(403);
    expect(await errorCode(browser)).toBe("paired_phone_required");
    expect((await claimWatchRequest(bearer(phone.token), { client: "app" })).status).toBe(400);

    const watch = (await (await claimWatchRequest(bearer(phone.token))).json()) as Claim;
    expect(await errorCode(await claimWatchRequest(bearer(watch.token)))).toBe("watch_scope");

    const agentInvite = await issuedInvite(await createInvite(request("/api/v1/paired/invites", { method: "POST", auth: await pairingAdminAuth(), headers: json, body: JSON.stringify({ client: "agent", displayName: "Agent", scope: "full" }) })));
    const agent = (await (await claimInvite(agentInvite, "Agent")).json()) as Claim;
    expect(await errorCode(await claimWatchRequest(bearer(agent.token)))).toBe("agent_scope");
  });

  it("asks a Watch to be invited by its phone, and a phone for its route", async () => {
    const auth = await admin();
    const watchByAdmin = await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "watch", clientId: "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1" }) }));
    expect(watchByAdmin.status).toBe(400);
    const controlsByAdmin = await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "app", scope: "rulesOnly", clientId: "f626e8d1-57bc-4c88-9068-7c9ce6d4d0d1" }) }));
    expect(controlsByAdmin.status).toBe(400);
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

  it("pairs nothing as the recovery admin, and voids what was left from before", async () => {
    const auth = await admin();
    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    const route = await homeRoute();
    const refused = await invitePhoneRequest(auth, { endpointId: route.id, accountId: recovery.id });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("personal_account_required");
    // Asking for no account means the one signed in, which is the recovery admin here.
    const unnamed = await createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ client: "app", displayName: "iPhone", endpointId: route.id }) }));
    expect(await errorCode(unnamed)).toBe("personal_account_required");
    expect(await prisma().pairing.count()).toBe(0);

    // A phone paired as the recovery admin before the rule: its invite, Watch, session and refresh are all refused.
    const phone = await pairPhone(auth);
    await prisma().pairing.updateMany({ data: { accountId: recovery.id } });
    await prisma().pairedDevice.updateMany({ data: { accountId: recovery.id } });
    await prisma().session.updateMany({ where: { deviceId: phone.device.id }, data: { accountId: recovery.id, username: "admin" } });
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(phone.token) }))).status).toBe(401);
    const renewed = await refresh(request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken: phone.refreshToken }) }));
    expect(renewed.status).toBe(403);

    const leftover = await issuedInvite(await invitePhoneRequest(auth, { endpointId: route.id, displayName: "Spare" }));
    await prisma().pairing.update({ where: { id: leftover.id }, data: { accountId: recovery.id } });
    expect((await claimInvite(leftover, "Spare")).status).toBe(403);
    expect(await prisma().pairedDevice.count({ where: { accountId: recovery.id } })).toBe(1);
  });
});
