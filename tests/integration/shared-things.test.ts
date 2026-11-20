/**
 * Shared Things (FamilyFi Me): a parent switches "Show in FamilyFi Me" on a Things group, and every child's
 * phone then reads it through the routes it reads its own group with, and asks for more time on
 * it. A parent answers with the verbs that answer a child's own ask. Things not shared stay hidden.
 */
import { randomBytes } from "node:crypto";
import { GroupKind, RuleKind, RuleMode } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as fileAskRoute } from "@/app/api/v1/groups/[id]/asks/route";
import { POST as declineRoute } from "@/app/api/v1/groups/[id]/asks/[askId]/decline/route";
import { POST as allowRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/allow/route";
import { POST as pauseRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as resumeRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { GET as oneGroup, PUT as putGroup } from "@/app/api/v1/groups/[id]/route";
import { GET as listGroupsRoute } from "@/app/api/v1/groups/route";
import { GET as listRulesRoute } from "@/app/api/v1/rules/route";
import type { Rule } from "@/lib/rules";
import type { Group, GroupAsk } from "@/lib/types";
import { registerPush } from "@/server/alerts/registrations";
import { prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { request, type SessionAuth } from "../helpers/http";
import { bearer, pairChildPhone, pairingAdminAuth, pairPhone } from "../helpers/pairing";

const json = { "content-type": "application/json" };
const MINUTE = 60_000;

function send(method: string, path: string, auth: SessionAuth, body?: unknown) {
  return request(path, { method, auth, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

const groupParams = (id: string) => ({ params: Promise.resolve({ id }) });
const ruleParams = (id: string, ruleId: string) => ({ params: Promise.resolve({ id, ruleId }) });

function share(auth: SessionAuth, groupId: string, kidsCanAsk: boolean) {
  return putGroup(send("PUT", `/api/v1/groups/${groupId}`, auth, { kidsCanAsk }), groupParams(groupId));
}

function ask(auth: SessionAuth, groupId: string, body: unknown) {
  return fileAskRoute(send("POST", `/api/v1/groups/${groupId}/asks`, auth, body), groupParams(groupId));
}

function verb(route: typeof pauseRoute, name: string, auth: SessionAuth, groupId: string, ruleId: string, body: unknown = {}) {
  return route(send("POST", `/api/v1/groups/${groupId}/rules/${ruleId}/${name}`, auth, body), ruleParams(groupId, ruleId));
}

function oneGroupOf(auth: SessionAuth, groupId: string) {
  return oneGroup(request(`/api/v1/groups/${groupId}`, { auth }), groupParams(groupId));
}

async function readGroup(auth: SessionAuth, groupId: string): Promise<Group> {
  const response = await oneGroupOf(auth, groupId);
  expect(response.status).toBe(200);
  return ((await response.json()) as { group: Group }).group;
}

async function groupsOf(auth: SessionAuth): Promise<Group[]> {
  const response = await listGroupsRoute(request("/api/v1/groups", { auth }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { groups: Group[] }).groups;
}

async function rulesOf(auth: SessionAuth, groupId?: string): Promise<Response> {
  return listRulesRoute(request(`/api/v1/rules${groupId ? `?groupId=${groupId}` : ""}`, { auth }));
}

async function askOf(response: Response): Promise<GroupAsk> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { group: Group }).group.ask!;
}

const hhmm = (date: Date) => date.toISOString().slice(11, 16);

/** A scheduled internet rule on `groupIds` whose window, every day, ran from an hour ago until two hours from now. */
async function windowRule(groupIds: string[], name: string) {
  const now = Date.now();
  return prisma().rule.create({
    data: {
      name,
      kind: RuleKind.internet,
      mode: RuleMode.scheduled,
      groups: { create: groupIds.map((groupId) => ({ groupId })) },
      windows: { create: [{ position: 0, name: "", days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(new Date(now - 60 * MINUTE)), end: hhmm(new Date(now + 120 * MINUTE)) }] },
    },
  });
}

describe("shared Things", () => {
  let admin: SessionAuth;
  let cassie: SessionAuth;
  let abby: SessionAuth;
  let cassieGroup: { id: string };
  let abbyGroup: { id: string };
  let tv: { id: string };
  let servers: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC" } });
    admin = await pairingAdminAuth();
    cassieGroup = await prisma().group.create({ data: { kind: GroupKind.family, name: "Cassie" } });
    abbyGroup = await prisma().group.create({ data: { kind: GroupKind.family, name: "Abby" } });
    tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
    servers = await prisma().group.create({ data: { kind: GroupKind.things, name: "Servers", monogram: "SRV" } });
    cassie = bearer((await pairChildPhone(admin, cassieGroup.id)).token);
    abby = bearer((await pairChildPhone(admin, abbyGroup.id)).token);
  });

  it("is a Things group's switch, off until a parent turns it on, and never a family group's", async () => {
    expect((await readGroup(admin, tv.id)).kidsCanAsk).toBe(false);
    expect((await readGroup(admin, cassieGroup.id)).kidsCanAsk).toBeUndefined();
    const on = await share(admin, tv.id, true);
    expect(on.status).toBe(200);
    expect(((await on.json()) as { group: Group }).group.kidsCanAsk).toBe(true);
    const family = await share(admin, cassieGroup.id, true);
    expect(family.status).toBe(400);
    expect((await errorOf(family)).code).toBe("invalid_request");
    // A child's phone shares nothing.
    expect((await share(cassie, tv.id, false)).status).toBe(403);
  });

  it("lets a child's phone read its own group and the shared Things, and nothing else", async () => {
    expect((await groupsOf(cassie)).map((group) => group.id)).toEqual([cassieGroup.id]);
    expect((await oneGroupOf(cassie, tv.id)).status).toBe(404);
    await share(admin, tv.id, true);

    expect((await groupsOf(cassie)).map((group) => group.name)).toEqual(["Cassie", "TV"]);
    expect((await readGroup(cassie, tv.id)).name).toBe("TV");
    // Another child's group, and a Thing not shared, stay hidden.
    expect((await oneGroupOf(cassie, abbyGroup.id)).status).toBe(404);
    expect((await oneGroupOf(cassie, servers.id)).status).toBe(404);
    // Parents still read every group.
    expect((await groupsOf(admin)).length).toBe(4);

    // The rules that cover them, each showing only the groups the child reads.
    const bedtime = await windowRule([cassieGroup.id, abbyGroup.id], "Bedtime");
    const downtime = await windowRule([tv.id, servers.id], "TV downtime");
    await windowRule([servers.id], "Backups");
    const all = await rulesOf(cassie);
    expect(all.status).toBe(200);
    const rules = ((await all.json()) as { rules: Rule[] }).rules;
    expect(rules.map((rule) => [rule.name, rule.groupIds])).toEqual(
      expect.arrayContaining([
        ["Bedtime", [cassieGroup.id]],
        ["TV downtime", [tv.id]],
      ]),
    );
    expect(rules).toHaveLength(2);
    const tvOnly = ((await (await rulesOf(cassie, tv.id)).json()) as { rules: Rule[] }).rules;
    expect(tvOnly.map((rule) => rule.id)).toEqual([downtime.id]);
    expect((await rulesOf(cassie, servers.id)).status).toBe(404);
    expect(bedtime.id).toBeTruthy();

    // Turned off, the Thing is gone again.
    await share(admin, tv.id, false);
    expect((await oneGroupOf(cassie, tv.id)).status).toBe(404);
    expect((await groupsOf(cassie)).map((group) => group.id)).toEqual([cassieGroup.id]);
  });

  it("lets a child ask to unpause a shared Thing, names the child to the parents, and takes the parent's resume as yes", async () => {
    await share(admin, tv.id, true);
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    const phone = (await pairPhone(admin)).device.id;
    await registerPush({ deviceId: phone }, phone, { platform: "ios", channel: "release", token: "t", key: randomBytes(32).toString("base64"), format: 1, kinds: ["ask.new"] });

    const notPaused = await ask(cassie, tv.id, { about: "pause" });
    expect(notPaused.status).toBe(409);
    expect(await errorOf(notPaused)).toEqual({ code: "not_blocked", message: "TV isn't blocked right now." });

    expect((await verb(pauseRoute, "pause", admin, tv.id, "internet")).status).toBe(200);
    const waiting = await askOf(await ask(cassie, tv.id, { about: "pause" }));
    expect(waiting).toMatchObject({ about: "pause", state: "waiting", from: { groupId: cassieGroup.id, name: "Cassie" } });
    const alerts = await prisma().alertEvent.findMany({ where: { kind: "ask.new" } });
    expect(alerts.map((alert) => alert.detail)).toEqual([{ g: tv.id, n: "Cassie", t: "TV", a: "pause" }]);
    // The parent sees who asked on the Thing's card.
    expect((await readGroup(admin, tv.id)).ask).toMatchObject({ id: waiting.id, from: { groupId: cassieGroup.id, name: "Cassie" } });
    // Cassie's own group has no ask.
    expect((await readGroup(cassie, cassieGroup.id)).ask).toBeUndefined();

    const yes = await verb(resumeRoute, "resume", admin, tv.id, "internet", { askId: waiting.id });
    expect(yes.status).toBe(200);
    expect((await readGroup(cassie, tv.id)).ask).toMatchObject({ id: waiting.id, state: "yes" });
  });

  it("asks for minutes off a shared Thing's rule, and the rule's allow for the Thing says yes", async () => {
    await share(admin, tv.id, true);
    const downtime = await windowRule([tv.id], "TV downtime");
    const notTv = await windowRule([servers.id], "Backups");
    const other = await ask(cassie, tv.id, { about: "rule", ruleId: notTv.id, minutes: 30 });
    expect(other.status).toBe(404);
    expect((await errorOf(other)).message).toBe("That rule doesn't cover TV.");

    const waiting = await askOf(await ask(cassie, tv.id, { about: "rule", ruleId: downtime.id, minutes: 30 }));
    expect(waiting).toMatchObject({ about: "rule", ruleId: downtime.id, minutes: 30, from: { name: "Cassie" } });
    expect((await verb(allowRoute, "allow", admin, tv.id, downtime.id, { askId: waiting.id })).status).toBe(200);
    expect((await readGroup(admin, tv.id)).ask).toMatchObject({ state: "yes" });
  });

  it("refuses an ask on a Thing not shared, or on another child's group", async () => {
    await verb(pauseRoute, "pause", admin, servers.id, "internet");
    expect((await ask(cassie, servers.id, { about: "pause" })).status).toBe(404);
    await verb(pauseRoute, "pause", admin, abbyGroup.id, "internet");
    expect((await ask(cassie, abbyGroup.id, { about: "pause" })).status).toBe(404);
    expect(await prisma().ask.count()).toBe(0);
  });

  it("has one waiting ask on a Thing, which each child reads only as their own, and a no makes only that child wait", async () => {
    await share(admin, tv.id, true);
    await verb(pauseRoute, "pause", admin, tv.id, "internet", { until: new Date(Date.now() + 3 * 60 * MINUTE).toISOString() });
    const first = await askOf(await ask(cassie, tv.id, { about: "pause" }));

    // Abby's phone does not tell Cassie's ask as Abby's, and Abby is told someone asked.
    expect((await readGroup(abby, tv.id)).ask).toBeUndefined();
    const second = await ask(abby, tv.id, { about: "pause" });
    expect(second.status).toBe(409);
    expect(await errorOf(second)).toEqual({ code: "ask_waiting", message: "Someone already asked about TV. Waiting for an answer." });
    const again = await ask(cassie, tv.id, { about: "pause" });
    expect(await errorOf(again)).toEqual({ code: "ask_waiting", message: "You already asked. Waiting for an answer." });

    const no = await declineRoute(send("POST", `/api/v1/groups/${tv.id}/asks/${first.id}/decline`, admin), { params: Promise.resolve({ id: tv.id, askId: first.id }) });
    expect(no.status).toBe(200);
    expect((await readGroup(cassie, tv.id)).ask).toMatchObject({ state: "no" });
    // Cassie waits the household's wait; Abby may ask now.
    expect((await errorOf(await ask(cassie, tv.id, { about: "pause" }))).code).toBe("ask_too_soon");
    const abbys = await askOf(await ask(abby, tv.id, { about: "pause" }));
    expect(abbys.from).toEqual({ groupId: abbyGroup.id, name: "Abby" });
    // Cassie still reads her own no and when she can ask again, never Abby's waiting ask.
    const cassies = (await readGroup(cassie, tv.id)).ask;
    expect(cassies).toMatchObject({ id: first.id, state: "no" });
    expect(cassies?.askAgainAt).toBeDefined();
    expect((await readGroup(abby, tv.id)).ask).toMatchObject({ id: abbys.id, state: "waiting" });
  });

  it("goes with the child's group", async () => {
    await share(admin, tv.id, true);
    await verb(pauseRoute, "pause", admin, tv.id, "internet");
    await askOf(await ask(cassie, tv.id, { about: "pause" }));
    await prisma().group.delete({ where: { id: cassieGroup.id } });
    expect(await prisma().ask.count()).toBe(0);
  });
});
