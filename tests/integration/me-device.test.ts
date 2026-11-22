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
import { GET as oneGroup } from "@/app/api/v1/groups/[id]/route";
import { GET as listRules } from "@/app/api/v1/rules/route";
import { POST as invite } from "@/app/api/v1/paired/invites/route";
import { POST as fileAsk } from "@/app/api/v1/groups/[id]/asks/route";
import { POST as pauseGroup } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { DELETE as unpair, GET as pairedDevice, PATCH as updateDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { groupDayOf, meDaySubject, tellDay, PHONE_VOICE, type GroupDay } from "@/lib/child-day";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { prisma } from "@/server/db";
import { deleteAccount } from "@/server/accounts";
import { removeAccountDevices, revokeDevice } from "@/server/connection";
import { deleteGroup } from "@/server/groups";
import { exportHousehold, importHousehold } from "@/server/household-export";
import { resetDatabase } from "../helpers/db";
import { request, type SessionAuth } from "../helpers/http";
import { bearer, claimInvite, claimWatchRequest, homeRoute, issuedInvite, pairingAdmin, pairingAdminAuth, pairPhone, type Claim } from "../helpers/pairing";

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
  const created = await inviteMe(admin, { endpointId: (await homeRoute()).id, personId: groupId });
  expect(created.status).toBe(201);
  const issued = await issuedInvite(created);
  expect(issued.payload.clientType).toBe("me");
  const claimed = await claimInvite(issued, "iPhone");
  expect(claimed.status).toBe(200);
  return (await claimed.json()) as Claim & { session: { kind: string; displayName: string } };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** A group, as the phone reads it. */
function meDay(auth: SessionAuth, groupId: string) {
  return oneGroup(request(`/api/v1/groups/${groupId}`, { auth }), params(groupId));
}

/** The rules a child's phone reads. */
async function childRules(token: string): Promise<Rule[]> {
  return ((await (await listRules(request("/api/v1/rules", { auth: bearer(token) }))).json()) as { rules: Rule[] }).rules;
}

/** The day FamilyFi Me builds from its group, its rules and the household's time zone. */
async function childDay(token: string, groupId: string): Promise<GroupDay> {
  const group = ((await (await meDay(bearer(token), groupId)).json()) as { group: Group }).group;
  const { timezone } = (await (await currentSession(request("/api/v1/auth/session", { auth: bearer(token) }))).json()) as { timezone: string };
  return groupDayOf(group, await childRules(token), timezone, new Date());
}

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
    expect(claim.session).toMatchObject({ kind: "person", displayName: "Emma", username: `device:${claim.device.id}`, personId: group.id });
    expect(claim.connection?.manifest.signature).toBeTruthy();
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claim.device.id } });
    expect(device).toMatchObject({ accountId: null, groupId: group.id, parentDeviceId: null });
    const session = await currentSession(request("/api/v1/auth/session", { auth: bearer(claim.token) }));
    expect(session.status).toBe(200);
    expect(((await session.json()) as { session: { kind: string; personId?: string } }).session).toMatchObject({ kind: "person", personId: group.id });
    await prisma().household.update({ where: { id: "default" }, data: { connectionError: "Gateway refused the key" } });
    const overview = await connection(request("/api/v1/connection", { auth: bearer(claim.token) }));
    expect(overview.status).toBe(200);
    // The manifest, never the household's last change or the gateway's error text.
    expect(await overview.json()).toMatchObject({ lastChange: null, unifi: { error: null } });
    const listed = await pairedDevice(request(`/api/v1/paired/devices/${claim.device.id}`, { auth: admin }), params(claim.device.id));
    expect(((await listed.json()) as { device: { person: unknown; actsAs: unknown } }).device).toMatchObject({ person: { id: group.id, name: "Emma" }, actsAs: null });
  });

  it("refuses a group of things, or one that does not exist", async () => {
    const things = await prisma().group.create({ data: { kind: GroupKind.things, name: "TVs" } });
    const endpointId = (await homeRoute()).id;
    const refused = await inviteMe(admin, { endpointId, personId: things.id });
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe("family_group_required");
    expect((await inviteMe(admin, { endpointId, personId: "missing" })).status).toBe(404);
    expect((await inviteMe(admin, { endpointId })).status).toBe(400);
    // The 2.0.0 name is refused, not ignored: a 2.0.x app is told to update instead.
    expect((await inviteMe(admin, { endpointId, groupId: (await childGroup()).id })).status).toBe(400);
  });

  it("renews with its refresh token", async () => {
    const emma = await childGroup();
    const claim = await pairMe(admin, emma.id);
    const renewed = await refresh(request("/api/v1/auth/refresh", { method: "POST", headers: json, body: JSON.stringify({ refreshToken: claim.refreshToken }) }));
    expect(renewed.status).toBe(200);
    const body = (await renewed.json()) as { token: string; session: { kind: string; displayName: string; personId?: string } };
    expect(body.session).toMatchObject({ kind: "person", displayName: "Emma", personId: emma.id });
    expect((await meDay(bearer(body.token), emma.id)).status).toBe(200);
  });

  it("reads its own group's day and nothing else in the household", async () => {
    const group = await childGroup();
    const sam = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam" } });
    const claim = await pairMe(admin, group.id);
    // Another group is not there for it.
    const other = await meDay(bearer(claim.token), sam.id);
    expect(other.status).toBe(404);
    expect(await errorCode(other)).toBe("not_found");
    // The group list holds its own group alone while no Thing is shared with children.
    const listed = await groups(request("/api/v1/groups", { auth: bearer(claim.token) }));
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { groups: Group[] }).groups.map((item) => item.id)).toEqual([group.id]);
    const read = await meDay(bearer(claim.token), group.id);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { group: Group }).group).toMatchObject({ id: group.id, name: "Emma" });
    // Its rules: only its own group's, and no other group's id.
    const otherRules = await listRules(request(`/api/v1/rules?groupId=${sam.id}`, { auth: bearer(claim.token) }));
    expect(otherRules.status).toBe(404);
  });

  it("tells the group's pause, windows and always-on rules, and leaves out a paused rule", async () => {
    const group = await childGroup();
    const sam = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam" } });
    const mom = await prisma().account.findFirstOrThrow({ where: { kind: "personal" } });
    await prisma().rule.create({
      data: {
        name: "Bedtime",
        kind: RuleKind.internet,
        mode: RuleMode.scheduled,
        // Sam's own lift, by a parent's account: the child's phone sees neither.
        groups: { create: [{ groupId: group.id }, { groupId: sam.id, pauseActive: true, pauseUntil: new Date(Date.now() + 60 * 60_000), pauseKind: "allow", pausedByAccountId: mom.id, pausedByName: "Mom" }] },
        windows: { create: [{ position: 0, name: "", days: [5, 0, 1], start: "21:00", end: "07:00" }] },
      },
    });
    await prisma().rule.create({ data: { name: "Games", kind: RuleKind.category, mode: RuleMode.always, targetIds: [8], groups: { create: { groupId: group.id } } } });
    await prisma().rule.create({ data: { name: "Paused rule", kind: RuleKind.app, mode: RuleMode.always, targetIds: [1], pauseActive: true, groups: { create: { groupId: group.id } } } });
    await prisma().rule.create({ data: { name: "Sam only", kind: RuleKind.internet, mode: RuleMode.always, groups: { create: { groupId: sam.id } } } });
    const until = new Date(Date.now() + 60 * 60_000);
    await prisma().rule.create({
      data: { name: "Emma paused", kind: RuleKind.internet, mode: RuleMode.always, systemGroupId: group.id, enabled: true, expiresAt: until, blockedByAccountId: mom.id, blockedByName: "Dad", groups: { create: { groupId: group.id } } },
    });
    // A rule-wide lift by the same account, on a rule the group has.
    await prisma().rule.create({ data: { name: "Video", kind: RuleKind.category, mode: RuleMode.always, targetIds: [5], pauseActive: true, pauseUntil: until, pauseKind: "allow", pausedByAccountId: mom.id, pausedByName: "Mom", groups: { create: { groupId: group.id } } } });
    const claim = await pairMe(admin, group.id);
    const read = ((await (await meDay(bearer(claim.token), group.id)).json()) as { group: Group }).group;
    expect(read.suspension.by).toEqual({ accountId: mom.id, name: "Dad" });
    const rules = await childRules(claim.token);
    expect(rules.find((rule) => rule.name === "Bedtime")?.groupPauses).toEqual([]);
    expect(rules.find((rule) => rule.name === "Video")?.pause.by).toEqual({ accountId: mom.id, name: "Mom" });
    expect(rules.map((rule) => rule.name).sort()).toEqual(["Bedtime", "Games", "Paused rule", "Video"]);
    expect(rules.find((rule) => rule.name === "Bedtime")?.groupIds).toEqual([group.id]);
    const day = await childDay(claim.token, group.id);
    expect(day.pause).toMatchObject({ by: "Dad", until: until.toISOString() });
    expect(day.allowance).toBeNull();
    expect(day.windows).toEqual([expect.objectContaining({ ruleName: "Bedtime", name: "", days: [0, 1, 5], start: "21:00", end: "07:00" })]);
    expect(day.alwaysOn).toEqual([expect.objectContaining({ name: "Games", kind: "category" }), expect.objectContaining({ name: "Video", allowed: { by: "Mom", until: until.toISOString() } })]);
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
    const day = await childDay(claim.token, group.id);
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
    const day = await childDay(claim.token, group.id);
    expect(day.pause).toMatchObject({ by: null, until: null });
    // Nor does the group it reads name an account.
    const read = ((await (await meDay(bearer(claim.token), group.id)).json()) as { group: Group }).group;
    expect(read.suspension.by).toBeNull();
    expect(JSON.stringify(read)).not.toContain(recovery.id);
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
    const day = await childDay(claim.token, group.id);
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

  it("tells its own Screen Time permission, and nothing else, and no one else may", async () => {
    const group = await childGroup();
    const first = await pairMe(admin, group.id);
    const second = await pairMe(admin, group.id);
    const patch = (auth: SessionAuth, id: string, body: Record<string, unknown>) =>
      updateDevice(request(`/api/v1/paired/devices/${id}`, { method: "PATCH", auth, headers: json, body: JSON.stringify(body) }), params(id));

    const told = await patch(bearer(first.token), first.device.id, { protection: "on" });
    expect(told.status).toBe(200);
    const { device } = (await told.json()) as { device: { protection: string; protectionAt: string } };
    expect(device).toMatchObject({ protection: "on" });
    expect(Date.parse(device.protectionAt)).not.toBeNaN();
    // An administrator reads it on the device, and a phone that has never said has none.
    const read = (await (await pairedDevice(request(`/api/v1/paired/devices/${first.device.id}`, { auth: admin }), params(first.device.id))).json()) as { device: Record<string, unknown> };
    expect(read.device.protection).toBe("on");
    const silent = (await (await pairedDevice(request(`/api/v1/paired/devices/${second.device.id}`, { auth: admin }), params(second.device.id))).json()) as { device: Record<string, unknown> };
    expect(silent.device).not.toHaveProperty("protection");

    // Another child's phone, an administrator, a name with it, or a value it doesn't know: refused.
    expect((await patch(bearer(first.token), second.device.id, { protection: "removed" })).status).toBe(403);
    const byAdmin = await patch(admin, first.device.id, { protection: "removed" });
    expect([byAdmin.status, await errorCode(byAdmin)]).toEqual([403, "own_device_required"]);
    const renamed = await patch(bearer(first.token), first.device.id, { protection: "on", displayName: "Mine now" });
    expect([renamed.status, await errorCode(renamed)]).toEqual([403, "administrator_required"]);
    expect((await patch(bearer(first.token), first.device.id, { displayName: "Mine now" })).status).toBe(403);
    expect((await patch(bearer(first.token), first.device.id, { protection: "maybe" })).status).toBe(400);
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: first.device.id } })).displayName).toBe("Emma's iPhone");
    // An administrator still renames it.
    expect((await patch(admin, first.device.id, { displayName: "Emma's old iPhone" })).status).toBe(200);
  });

  it("is heard from again when it next reads, so going quiet again is told again", async () => {
    const group = await childGroup();
    const phone = await pairMe(admin, group.id);
    await prisma().pairedDevice.update({ where: { id: phone.device.id }, data: { lastSeenAt: new Date(0), quietAlertedAt: new Date() } });
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(phone.token) }))).status).toBe(200);
    const after = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: phone.device.id } });
    expect(after.quietAlertedAt).toBeNull();
    expect(after.lastSeenAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
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
    const fromPhone = await issuedInvite(await inviteMe(bearer(phone.token), { endpointId: (await homeRoute()).id, personId: group.id }));
    const fromBrowser = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, personId: group.id }));
    await revokeDevice(phone.device.id);
    expect((await claimInvite(fromPhone, "iPhone")).status).toBe(403);
    await removeAccountDevices((await pairingAdmin()).id);
    expect((await claimInvite(fromBrowser, "iPhone")).status).toBe(403);
  });

  it("is never claimed once the administrator who invited it is deleted", async () => {
    const group = await childGroup();
    const issued = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, personId: group.id }));
    await deleteAccount((await pairingAdmin()).id);
    expect((await claimInvite(issued, "iPhone")).status).toBe(403);
  });

  it("stays paired when the phone that invited it is revoked: it belongs to its group", async () => {
    const group = await childGroup();
    const phone = await pairPhone(admin);
    const issued = await issuedInvite(await inviteMe(bearer(phone.token), { endpointId: (await homeRoute()).id, personId: group.id }));
    const claimed = (await (await claimInvite(issued, "iPhone")).json()) as Claim;
    await revokeDevice(phone.device.id);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("is never claimed once its group is gone", async () => {
    const group = await childGroup();
    const issued = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, personId: group.id }));
    await deleteGroup(group.id);
    expect((await claimInvite(issued, "iPhone")).status).toBe(403);
  });

  it("keeps its group through an import that brings the group back, and is revoked by one that does not", async () => {
    const kept = await childGroup();
    const archive = (await exportHousehold()).archive;
    const keptPhone = await pairMe(admin, kept.id);
    const waiting = await issuedInvite(await inviteMe(admin, { endpointId: (await homeRoute()).id, personId: kept.id }));
    const gone = await childGroup("Sam");
    const gonePhone = await pairMe(admin, gone.id);
    await importHousehold("apply", archive, { accountId: (await pairingAdmin()).id });
    const keptDevice = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: keptPhone.device.id } });
    expect(keptDevice).toMatchObject({ groupId: kept.id, revokedAt: null });
    expect((await meDay(bearer(keptPhone.token), kept.id)).status).toBe(200);
    const goneDevice = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: gonePhone.device.id } });
    expect(goneDevice.revokedAt).not.toBeNull();
    // An invite still waiting for a group that came back can still be claimed.
    expect((await claimInvite(waiting, "iPhone")).status).toBe(200);
  });
});

describe("FamilyFi Me's Watch", () => {
  let admin: SessionAuth;

  beforeEach(async () => {
    await resetDatabase();
    admin = await pairingAdminAuth();
  });

  const WATCH_ID = "0c3f7a52-8a4e-4c1b-9d55-7f1e2b6a9c10";

  function setUpWatch(auth: SessionAuth, body: Record<string, unknown> = {}) {
    return claimWatchRequest(auth, { clientType: "me-watch", clientId: WATCH_ID, ...body });
  }

  async function pairWatch(phone: Claim): Promise<Claim & { session: { kind: string; displayName: string; personId?: string } }> {
    const response = await setUpWatch(bearer(phone.token));
    expect(response.status).toBe(201);
    return (await response.json()) as Claim & { session: { kind: string; displayName: string; personId?: string } };
  }

  it("is set up by its phone for the same person, as no account, with its manifest", async () => {
    const emma = await childGroup();
    const phone = await pairMe(admin, emma.id);
    const watch = await pairWatch(phone);
    expect(watch.device).toMatchObject({ clientType: "me-watch", scope: "me:askOnly", displayName: "Watch" });
    expect(watch.session).toMatchObject({ kind: "person", displayName: "Emma", personId: emma.id });
    expect(watch.connection?.manifest.signature).toBeTruthy();
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: watch.device.id } });
    expect(device).toMatchObject({ accountId: null, groupId: emma.id, parentDeviceId: phone.device.id });
    const listed = await pairedDevice(request(`/api/v1/paired/devices/${watch.device.id}`, { auth: admin }), params(watch.device.id));
    expect(((await listed.json()) as { device: { person: unknown; actsAs: unknown } }).device).toMatchObject({ person: { id: emma.id, name: "Emma" }, actsAs: null });
  });

  it("reads its person's day and nothing else, and asks for more time itself", async () => {
    const emma = await childGroup();
    const sam = await childGroup("Sam");
    const watch = await pairWatch(await pairMe(admin, emma.id));
    expect((await meDay(bearer(watch.token), emma.id)).status).toBe(200);
    expect((await meDay(bearer(watch.token), sam.id)).status).toBe(404);
    const listed = await groups(request("/api/v1/groups", { auth: bearer(watch.token) }));
    expect(((await listed.json()) as { groups: Group[] }).groups.map((item) => item.id)).toEqual([emma.id]);
    const until = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const paused = await pauseGroup(request(`/api/v1/groups/${emma.id}/rules/internet/pause`, { method: "POST", auth: admin, headers: json, body: JSON.stringify({ until }) }), { params: Promise.resolve({ id: emma.id, ruleId: "internet" }) });
    expect(paused.status).toBe(200);
    const asked = await fileAsk(request(`/api/v1/groups/${emma.id}/asks`, { method: "POST", auth: bearer(watch.token), headers: json, body: JSON.stringify({ about: "pause" }) }), params(emma.id));
    expect(asked.status).toBe(200);
    expect(((await asked.json()) as { group: Group }).group.ask).toMatchObject({ about: "pause", state: "waiting" });
  });

  it("sets up no Watch of its own and reports no Screen Time permission", async () => {
    const emma = await childGroup();
    const watch = await pairWatch(await pairMe(admin, emma.id));
    const again = await setUpWatch(bearer(watch.token), { clientId: "5d1b7c30-2b0e-4f3a-a3f1-6c9e1d2b4a77" });
    expect([again.status, await errorCode(again)]).toEqual([403, "me_scope"]);
    const told = await updateDevice(request(`/api/v1/paired/devices/${watch.device.id}`, { method: "PATCH", auth: bearer(watch.token), headers: json, body: JSON.stringify({ protection: "on" }) }), params(watch.device.id));
    expect(told.status).toBe(403);
  });

  it("is set up only by FamilyFi Me, and FamilyFi Me sets up nothing else", async () => {
    const emma = await childGroup();
    const phone = await pairMe(admin, emma.id);
    // FamilyFi Me sets up only its Watch.
    const app = await setUpWatch(bearer(phone.token), { clientType: "app-watch" });
    expect(app.status).toBe(400);
    // A browser, an app or an app's Watch sets up no FamilyFi Me Watch.
    expect((await setUpWatch(admin)).status).toBe(403);
    const parent = await pairPhone(admin);
    expect((await setUpWatch(bearer(parent.token))).status).toBe(400);
  });

  it("replaces the Watch it set up before, and is revoked with its phone and with its person", async () => {
    const emma = await childGroup();
    const phone = await pairMe(admin, emma.id);
    const first = await pairWatch(phone);
    const second = await pairWatch(phone);
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: first.device.id } })).revokedAt).not.toBeNull();
    await revokeDevice(phone.device.id);
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(second.token) }))).status).toBe(401);

    const otherPhone = await pairMe(admin, emma.id);
    const third = await pairWatch(otherPhone);
    await deleteGroup(emma.id);
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: third.device.id } })).revokedAt).not.toBeNull();
  });
});

