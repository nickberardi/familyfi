/**
 * FamilyFi Me on a child's phone: a paired device (`me`, `me:askOnly`) that signs in for a family
 * group, never as an account. It is invited like a phone, reads its own group's day and nothing else
 * in the household, un-pairs itself, and is revoked when its group goes.
 */
import { GroupKind, RuleKind, RuleMode } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { GET as groups } from "@/app/api/v1/groups/route";
import { GET as meDay } from "@/app/api/v1/me/day/route";
import { POST as invite } from "@/app/api/v1/paired/invites/route";
import { DELETE as unpair, GET as pairedDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { meDaySubject, tellDay, PHONE_VOICE, type MeDay } from "@/lib/child-day";
import { prisma } from "@/server/db";
import { deleteAccount } from "@/server/accounts";
import { removeAccountDevices, revokeDevice } from "@/server/connection";
import { deleteGroup } from "@/server/groups";
import { exportHousehold, importHousehold } from "@/server/household-export";
import { resetDatabase } from "../helpers/db";
import { request, type SessionAuth } from "../helpers/http";
import { bearer, claimInvite, homeRoute, issuedInvite, pairingAdmin, pairingAdminAuth, pairPhone, type Claim } from "../helpers/pairing";

const json = { "content-type": "application/json" };

function inviteMe(auth: SessionAuth, body: Record<string, unknown>) {
  return invite(request("/api/v1/paired/invites", { method: "POST", auth, headers: json, body: JSON.stringify({ clientType: "me", displayName: "Emma's iPhone", ...body }) }));
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

async function childGroup(name = "Emma") {
  return prisma().group.create({ data: { kind: GroupKind.family, name } });
}

/** A child's phone paired the way FamilyFi Me does it: an administrator invites it for a group, and it claims the code. */
async function pairMe(admin: SessionAuth, groupId: string): Promise<Claim & { session: { kind: string; displayName: string } }> {
  const created = await inviteMe(admin, { endpointId: (await homeRoute()).id, groupId });
  expect(created.status).toBe(201);
  const issued = await issuedInvite(created);
  expect(issued.payload.clientType).toBe("me");
  const claimed = await claimInvite(issued, "iPhone");
  expect(claimed.status).toBe(200);
  return (await claimed.json()) as Claim & { session: { kind: string; displayName: string } };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("FamilyFi Me on a child's phone", () => {
  let admin: SessionAuth;

  beforeEach(async () => {
    await resetDatabase();
    admin = await pairingAdminAuth();
  });

  it("pairs for a family group, as no account, with the phone's route and manifest", async () => {
    const group = await childGroup();
    const claim = await pairMe(admin, group.id);
    expect(claim.device).toMatchObject({ clientType: "me", scope: "me:askOnly", displayName: "Emma's iPhone" });
    expect(claim.session).toMatchObject({ kind: "me", displayName: "Emma", username: `device:${claim.device.id}` });
    expect(claim.connection?.manifest.signature).toBeTruthy();
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } });
    expect(device).toMatchObject({ accountId: null, groupId: group.id, parentDeviceId: null });
    const session = await currentSession(request("/api/v1/auth/session", { auth: bearer(claim.token) }));
    expect(session.status).toBe(200);
    expect(((await session.json()) as { session: { kind: string } }).session.kind).toBe("me");
    await prisma().household.update({ where: { id: "default" }, data: { connectionError: "Gateway refused the key" } });
    const overview = await connection(request("/api/v1/connection", { auth: bearer(claim.token) }));
    expect(overview.status).toBe(200);
    // The manifest, never the household's last change or the gateway's error text.
    expect(await overview.json()).toMatchObject({ lastChange: null, unifi: { error: null } });
    const listed = await pairedDevice(request(`/api/v1/paired/devices/${claim.device.id}`, { auth: admin }), params(claim.device.id));
    expect(((await listed.json()) as { device: { group: unknown; actsAs: unknown } }).device).toMatchObject({ group: { id: group.id, name: "Emma" }, actsAs: null });
  });

  it("refuses a group of things, or one that does not exist", async () => {
    const things = await prisma().group.create({ data: { kind: GroupKind.things, name: "TVs" } });
    const endpointId = (await homeRoute()).id;
    const refused = await inviteMe(admin, { endpointId, groupId: things.id });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("family_group_required");
    expect((await inviteMe(admin, { endpointId, groupId: "missing" })).status).toBe(404);
    expect((await inviteMe(admin, { endpointId })).status).toBe(400);
  });

  it("renews with its refresh token", async () => {
    const claim = await pairMe(admin, (await childGroup()).id);
    const renewed = await refresh(request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken: claim.refreshToken }) }));
    expect(renewed.status).toBe(200);
    const body = (await renewed.json()) as { token: string; session: { kind: string; displayName: string } };
    expect(body.session).toMatchObject({ kind: "me", displayName: "Emma" });
    expect((await meDay(request("/api/v1/me/day", { auth: bearer(body.token) }))).status).toBe(200);
  });

  it("reads its own group's day and nothing else in the household", async () => {
    const group = await childGroup();
    await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam" } });
    const claim = await pairMe(admin, group.id);
    const refused = await groups(request("/api/v1/groups", { auth: bearer(claim.token) }));
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("me_scope");
    const read = await meDay(request("/api/v1/me/day", { auth: bearer(claim.token) }));
    expect(read.status).toBe(200);
    expect(((await read.json()) as MeDay).group).toEqual({ id: group.id, name: "Emma" });
    // A person in a browser has no day of their own.
    const browser = await meDay(request("/api/v1/me/day", { auth: admin }));
    expect(browser.status).toBe(403);
    expect(await errorCode(browser)).toBe("me_required");
  });

  it("tells the group's pause, windows and always-on rules, and leaves out a paused rule", async () => {
    const group = await childGroup();
    const sam = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam" } });
    await prisma().rule.create({
      data: {
        name: "Bedtime",
        kind: RuleKind.internet,
        mode: RuleMode.scheduled,
        groups: { create: [{ groupId: group.id }, { groupId: sam.id }] },
        windows: { create: [{ position: 0, name: "", days: [5, 0, 1], start: "21:00", end: "07:00" }] },
      },
    });
    await prisma().rule.create({ data: { name: "Games", kind: RuleKind.category, mode: RuleMode.always, targetIds: [8], groups: { create: { groupId: group.id } } } });
    await prisma().rule.create({ data: { name: "Paused rule", kind: RuleKind.app, mode: RuleMode.always, targetIds: [1], pauseActive: true, groups: { create: { groupId: group.id } } } });
    await prisma().rule.create({ data: { name: "Sam only", kind: RuleKind.internet, mode: RuleMode.always, groups: { create: { groupId: sam.id } } } });
    const until = new Date(Date.now() + 60 * 60_000);
    await prisma().rule.create({
      data: { name: "Emma paused", kind: RuleKind.internet, mode: RuleMode.always, systemGroupId: group.id, enabled: true, expiresAt: until, blockedByName: "Dad", groups: { create: { groupId: group.id } } },
    });
    const claim = await pairMe(admin, group.id);
    const day = (await (await meDay(request("/api/v1/me/day", { auth: bearer(claim.token) }))).json()) as MeDay;
    expect(day.pause).toMatchObject({ by: "Dad", until: until.toISOString() });
    expect(day.allowance).toBeNull();
    expect(day.windows).toEqual([expect.objectContaining({ ruleName: "Bedtime", name: "", days: [0, 1, 5], start: "21:00", end: "07:00" })]);
    expect(day.alwaysOn).toEqual([expect.objectContaining({ name: "Games", kind: "category" })]);
    // FamilyFi Me tells it with the shared day: paused now, by Dad.
    const { subject, now, clock } = meDaySubject(day, new Date());
    expect(tellDay(subject, now, PHONE_VOICE, clock).day.kind).toBe("paused");
  });

  it("marks a window or always-on rule lifted until a time, and leaves out a rule lifted with no end", async () => {
    const group = await childGroup();
    const later = new Date(Date.now() + 60 * 60_000);
    const window = { create: [{ position: 0, name: "", days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "07:00" }] };
    await prisma().rule.create({
      data: { name: "Bedtime", kind: RuleKind.internet, mode: RuleMode.scheduled, pauseActive: true, pauseUntil: later, pauseKind: "allow", groups: { create: { groupId: group.id } }, windows: window },
    });
    await prisma().rule.create({
      data: { name: "Games", kind: RuleKind.category, mode: RuleMode.always, targetIds: [8], groups: { create: { groupId: group.id, pauseActive: true, pauseUntil: later, pauseKind: "allow" } } },
    });
    await prisma().rule.create({ data: { name: "Homework", kind: RuleKind.internet, mode: RuleMode.scheduled, groups: { create: { groupId: group.id } }, windows: window } });
    await prisma().rule.create({
      data: { name: "Reading", kind: RuleKind.internet, mode: RuleMode.scheduled, groups: { create: { groupId: group.id, pauseActive: true, pauseUntil: null, pauseKind: "allow" } }, windows: window },
    });
    // This group's own allowance, by Mom: the later of the two lifts counts.
    const latest = new Date(Date.now() + 2 * 60 * 60_000);
    await prisma().ruleGroup.updateMany({ where: { groupId: group.id, rule: { name: "Bedtime" } }, data: { pauseActive: true, pauseUntil: latest, pauseKind: "allow", pausedByName: "Mom" } });
    const claim = await pairMe(admin, group.id);
    const day = (await (await meDay(request("/api/v1/me/day", { auth: bearer(claim.token) }))).json()) as MeDay;
    expect(day.windows.map((entry) => [entry.ruleName, entry.allowed])).toEqual([
      ["Bedtime", { by: "Mom", until: latest.toISOString() }],
      ["Homework", null],
    ]);
    expect(day.alwaysOn).toEqual([expect.objectContaining({ name: "Games", allowed: { by: null, until: later.toISOString() } })]);
  });

  it("names no one for a pause the recovery account made", async () => {
    const group = await childGroup();
    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    await prisma().rule.create({
      data: { name: "Emma paused", kind: RuleKind.internet, mode: RuleMode.always, systemGroupId: group.id, enabled: true, blockedByAccountId: recovery.id, blockedByName: "Recovery admin", groups: { create: { groupId: group.id } } },
    });
    const claim = await pairMe(admin, group.id);
    const day = (await (await meDay(request("/api/v1/me/day", { auth: bearer(claim.token) }))).json()) as MeDay;
    expect(day.pause).toMatchObject({ by: null, until: null });
  });

  it("names no one for an allowance the recovery account gave", async () => {
    const group = await childGroup();
    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    await prisma().rule.create({
      data: {
        name: "Bedtime",
        kind: RuleKind.internet,
        mode: RuleMode.always,
        groups: { create: { groupId: group.id, pauseActive: true, pauseUntil: new Date(Date.now() + 60 * 60_000), pauseKind: "allow", pausedByAccountId: recovery.id, pausedByName: "Recovery admin" } },
      },
    });
    const claim = await pairMe(admin, group.id);
    const day = (await (await meDay(request("/api/v1/me/day", { auth: bearer(claim.token) }))).json()) as MeDay;
    expect(day.allowance).toMatchObject({ by: null });
  });

  it("un-pairs itself, and only itself", async () => {
    const group = await childGroup();
    const first = await pairMe(admin, group.id);
    const second = await pairMe(admin, group.id);
    const other = await unpair(request(`/api/v1/paired/devices/${second.device.id}`, { method: "DELETE", auth: bearer(first.token) }), params(second.device.id));
    expect(other.status).toBe(403);
    const own = await unpair(request(`/api/v1/paired/devices/${first.device.id}`, { method: "DELETE", auth: bearer(first.token) }), params(first.device.id));
    expect(own.status).toBe(200);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(first.token) }))).status).toBe(401);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(second.token) }))).status).toBe(200);
  });

  it("is revoked, its record kept, when its group is deleted", async () => {
    const group = await childGroup();
    const claim = await pairMe(admin, group.id);
    await deleteGroup(group.id);
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } });
    expect(device.revokedAt).not.toBeNull();
    expect(device.groupId).toBeNull();
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claim.token) }))).status).toBe(401);
    const renewed = await refresh(request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken: claim.refreshToken }) }));
    expect(renewed.status).toBe(403);
  });

  it("is never claimed once the phone that invited it is revoked, or its administrator is demoted", async () => {
    const group = await childGroup();
    const phone = await pairPhone(admin);
    const fromPhone = await issuedInvite(await inviteMe(bearer(phone.token), { endpointId: (await homeRoute()).id, groupId: group.id }));
    const fromBrowser = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, groupId: group.id }));
    await revokeDevice(phone.device.id);
    expect((await claimInvite(fromPhone, "iPhone")).status).toBe(403);
    await removeAccountDevices((await pairingAdmin()).id);
    expect((await claimInvite(fromBrowser, "iPhone")).status).toBe(403);
  });

  it("is never claimed once the administrator who invited it is deleted", async () => {
    const group = await childGroup();
    const issued = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, groupId: group.id }));
    await deleteAccount((await pairingAdmin()).id);
    expect((await claimInvite(issued, "iPhone")).status).toBe(403);
  });

  it("stays paired when the phone that invited it is revoked: it belongs to its group", async () => {
    const group = await childGroup();
    const phone = await pairPhone(admin);
    const issued = await issuedInvite(await inviteMe(bearer(phone.token), { endpointId: (await homeRoute()).id, groupId: group.id }));
    const claimed = (await (await claimInvite(issued, "iPhone")).json()) as Claim;
    await revokeDevice(phone.device.id);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("is never claimed once its group is gone", async () => {
    const group = await childGroup();
    const issued = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, groupId: group.id }));
    await deleteGroup(group.id);
    expect((await claimInvite(issued, "iPhone")).status).toBe(403);
  });

  it("keeps its group through an import that brings the group back, and is revoked by one that does not", async () => {
    const kept = await childGroup();
    const archive = (await exportHousehold()).archive;
    const keptPhone = await pairMe(admin, kept.id);
    const waiting = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, groupId: kept.id }));
    const gone = await childGroup("Sam");
    const gonePhone = await pairMe(admin, gone.id);
    await importHousehold("apply", archive, { accountId: (await pairingAdmin()).id });
    const keptDevice = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: keptPhone.device.id } });
    expect(keptDevice).toMatchObject({ groupId: kept.id, revokedAt: null });
    expect((await meDay(request("/api/v1/me/day", { auth: bearer(keptPhone.token) }))).status).toBe(200);
    const goneDevice = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: gonePhone.device.id } });
    expect(goneDevice.revokedAt).not.toBeNull();
    // An invite still waiting for a group that came back can still be claimed.
    expect((await claimInvite(waiting, "iPhone")).status).toBe(200);
  });
});
