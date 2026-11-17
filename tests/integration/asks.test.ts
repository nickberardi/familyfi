/**
 * Asking for more time: FamilyFi Me on a child's phone asks on its own group, to be unpaused or for
 * minutes in a rule's window, and a parent answers. Yes is the verb that lifts it, with `askId`; no
 * is decline. Any other write that lifts what the ask is about answers it yes too, and an ask nobody
 * answers closes on its own.
 */
import { randomBytes } from "node:crypto";
import { GroupKind, RuleKind, RuleMode } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as fileAskRoute } from "@/app/api/v1/groups/[id]/asks/route";
import { POST as declineRoute } from "@/app/api/v1/groups/[id]/asks/[askId]/decline/route";
import { POST as allowRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/allow/route";
import { POST as pauseRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as resumeRoute } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { POST as rulePauseRoute } from "@/app/api/v1/rules/[id]/pause/route";
import { GET as oneGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as unblockRoute } from "@/app/api/v1/groups/[id]/unblock/route";
import { PUT as putHousehold } from "@/app/api/v1/settings/household/route";
import type { Group, GroupAsk } from "@/lib/types";
import { registerPush } from "@/server/alerts/registrations";
import { ASKS_PER_HOUR, closeLapsedAsks } from "@/server/asks";
import { liftGroupRule } from "@/server/group-internet";
import { prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { request, type SessionAuth } from "../helpers/http";
import { bearer, pairChildPhone, pairingAdminAuth, pairPhone } from "../helpers/pairing";
import { adminSession } from "../helpers/session";

const json = { "content-type": "application/json" };
const MINUTE = 60_000;

function post(path: string, auth: SessionAuth, body?: unknown) {
  return request(path, { method: "POST", auth, headers: json, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

const groupParams = (id: string) => ({ params: Promise.resolve({ id }) });
const ruleParams = (id: string, ruleId: string) => ({ params: Promise.resolve({ id, ruleId }) });

function ask(auth: SessionAuth, groupId: string, body: unknown) {
  return fileAskRoute(post(`/api/v1/groups/${groupId}/asks`, auth, body), groupParams(groupId));
}

function decline(auth: SessionAuth, groupId: string, askId: string) {
  return declineRoute(post(`/api/v1/groups/${groupId}/asks/${askId}/decline`, auth), { params: Promise.resolve({ id: groupId, askId }) });
}

function verb(route: typeof pauseRoute, name: string, auth: SessionAuth, groupId: string, ruleId: string, body: unknown = {}) {
  return route(post(`/api/v1/groups/${groupId}/rules/${ruleId}/${name}`, auth, body), ruleParams(groupId, ruleId));
}

async function readGroup(auth: SessionAuth, groupId: string): Promise<Group> {
  const response = await oneGroup(request(`/api/v1/groups/${groupId}`, { auth }), groupParams(groupId));
  expect(response.status).toBe(200);
  return ((await response.json()) as { group: Group }).group;
}

async function askOf(response: Response): Promise<GroupAsk> {
  expect(response.status).toBe(200);
  return ((await response.json()) as { group: Group }).group.ask!;
}

const hhmm = (date: Date) => date.toISOString().slice(11, 16);

/** A scheduled internet rule on `groupId` whose window, every day, ran from an hour ago until `endsIn` from now. */
async function windowRule(groupId: string, endsIn = 2 * 60 * MINUTE, name = "Homework") {
  const now = Date.now();
  return prisma().rule.create({
    data: {
      name,
      kind: RuleKind.internet,
      mode: RuleMode.scheduled,
      groups: { create: { groupId } },
      windows: { create: [{ position: 0, name: "", days: [0, 1, 2, 3, 4, 5, 6], start: hhmm(new Date(now - 60 * MINUTE)), end: hhmm(new Date(now + endsIn)) }] },
    },
  });
}

describe("asking for more time", () => {
  let admin: SessionAuth;
  let child: SessionAuth;
  let emma: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC" } });
    admin = await pairingAdminAuth();
    emma = await prisma().group.create({ data: { kind: GroupKind.family, name: "Emma" } });
    child = bearer((await pairChildPhone(admin, emma.id)).token);
  });

  it("asks to be unpaused, alerts the parents, and a parent's resume with its id says yes once", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    const phone = (await pairPhone(admin)).device.id;
    await registerPush({ deviceId: phone }, phone, { platform: "ios", channel: "release", token: "t", key: randomBytes(32).toString("base64"), format: 1, kinds: ["ask.new"] });
    expect((await verb(pauseRoute, "pause", admin, emma.id, "internet", { until: new Date(Date.now() + 3 * 60 * MINUTE).toISOString() })).status).toBe(200);

    const waiting = await askOf(await ask(child, emma.id, { about: "pause" }));
    expect(waiting).toMatchObject({ about: "pause", state: "waiting" });
    expect(waiting.minutes).toBeUndefined();
    // The household's timeout, an hour, comes before the pause's end.
    expect(Date.parse(waiting.expiresAt!) - Date.parse(waiting.at)).toBe(60 * MINUTE);
    expect((await readGroup(admin, emma.id)).ask).toMatchObject({ id: waiting.id, state: "waiting" });
    const alerts = await prisma().alertEvent.findMany({ where: { kind: "ask.new" } });
    expect(alerts.map((alert) => [alert.deviceId, alert.detail])).toEqual([[phone, { g: emma.id, n: "Emma", a: "pause" }]]);

    const yes = await verb(resumeRoute, "resume", admin, emma.id, "internet", { askId: waiting.id });
    expect(yes.status).toBe(200);
    const group = ((await yes.json()) as { group: Group }).group;
    expect(group.suspension.active).toBe(false);
    expect(group.ask).toMatchObject({ id: waiting.id, state: "yes", by: { name: "Household admin" } });
    // A second parent answering the same ask is told it has closed.
    const again = await verb(resumeRoute, "resume", admin, emma.id, "internet", { askId: waiting.id });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("ask_closed");
    // The child reads the answer on its own group.
    expect((await readGroup(child, emma.id)).ask).toMatchObject({ state: "yes", by: { name: "Household admin" } });
  });

  it("asks for minutes in a window, and a yes lifts the rule for the group that long, never past the window's end", async () => {
    const homework = await windowRule(emma.id);
    const waiting = await askOf(await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes: 30 }));
    expect(waiting).toMatchObject({ about: "rule", ruleId: homework.id, minutes: 30, state: "waiting" });
    const before = Date.now();
    const yes = await verb(allowRoute, "allow", admin, emma.id, homework.id, { askId: waiting.id });
    expect(yes.status).toBe(200);
    const link = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: homework.id, groupId: emma.id } } });
    expect(link).toMatchObject({ pauseActive: true, pauseKind: "allow" });
    expect(Math.abs(link.pauseUntil!.getTime() - (before + 30 * MINUTE))).toBeLessThan(5_000);
    expect((await prisma().ask.findUniqueOrThrow({ where: { id: waiting.id } })).state).toBe("yes");

    // A window ending in 20 minutes: an hour's yes ends with it, and so does the ask unanswered.
    const reading = await windowRule(emma.id, 20 * MINUTE, "Reading");
    const short = await askOf(await ask(child, emma.id, { about: "rule", ruleId: reading.id, minutes: 60 }));
    const windowEnd = Date.parse(short.expiresAt!);
    expect(windowEnd - Date.now()).toBeLessThanOrEqual(20 * MINUTE);
    expect((await verb(allowRoute, "allow", admin, emma.id, reading.id, { askId: short.id })).status).toBe(200);
    const capped = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: reading.id, groupId: emma.id } } });
    expect(capped.pauseUntil!.getTime()).toBe(windowEnd);
  });

  it("takes a parent's Not now, and the child asks again only after the household's wait", async () => {
    expect((await putHousehold(request("/api/v1/settings/household", { method: "PUT", auth: admin, headers: json, body: JSON.stringify({ askWaitMinutes: 10 }) }))).status).toBe(200);
    await verb(pauseRoute, "pause", admin, emma.id, "internet");
    const waiting = await askOf(await ask(child, emma.id, { about: "pause" }));
    const no = await askOf(await decline(admin, emma.id, waiting.id));
    expect(no).toMatchObject({ state: "no", by: { name: "Household admin" } });
    expect(Date.parse(no.askAgainAt!) - Date.parse(no.answeredAt!)).toBe(10 * MINUTE);
    const soon = await ask(child, emma.id, { about: "pause" });
    expect(soon.status).toBe(409);
    expect(await errorCode(soon)).toBe("ask_too_soon");
    const twice = await decline(admin, emma.id, waiting.id);
    expect(twice.status).toBe(409);
    expect(await errorCode(twice)).toBe("ask_closed");
    // A yes by its id after a no is too late as well.
    expect((await verb(resumeRoute, "resume", admin, emma.id, "internet", { askId: waiting.id })).status).toBe(409);
    expect((await readGroup(admin, emma.id)).suspension.active).toBe(true);

    await prisma().ask.update({ where: { id: waiting.id }, data: { askAgainAt: new Date(Date.now() - MINUTE) } });
    expect((await ask(child, emma.id, { about: "pause" })).status).toBe(200);
  });

  it("refuses what a child cannot ask", async () => {
    const sam = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam" } });
    const parent = await ask(admin, emma.id, { about: "pause" });
    expect(parent.status).toBe(403);
    expect(await errorCode(parent)).toBe("child_only");
    expect((await ask(child, sam.id, { about: "pause" })).status).toBe(404);
    const unpaused = await ask(child, emma.id, { about: "pause" });
    expect(unpaused.status).toBe(409);
    expect(await errorCode(unpaused)).toBe("not_blocked");
    const always = await prisma().rule.create({ data: { name: "No internet", kind: RuleKind.internet, mode: RuleMode.always, groups: { create: { groupId: emma.id } } } });
    const allDay = await ask(child, emma.id, { about: "rule", ruleId: always.id, minutes: 30 });
    expect(allDay.status).toBe(409);
    expect(await errorCode(allDay)).toBe("always_on");
    const samsRule = await windowRule(sam.id);
    expect((await ask(child, emma.id, { about: "rule", ruleId: samsRule.id, minutes: 30 })).status).toBe(404);
    const homework = await windowRule(emma.id);
    for (const minutes of [0, 4, 241, 1.5]) expect((await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes })).status, String(minutes)).toBe(400);
    expect((await ask(child, emma.id, { about: "rule", ruleId: homework.id })).status).toBe(400);

    expect((await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes: 30 })).status).toBe(200);
    const second = await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes: 15 });
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("ask_waiting");
    // An askId on a verb that does not lift what the ask is about, or on a rule's own verb, is refused.
    const waiting = (await readGroup(admin, emma.id)).ask!;
    expect((await verb(resumeRoute, "resume", admin, emma.id, "internet", { askId: waiting.id })).status).toBe(400);
    const ruleWide = await rulePauseRoute(post(`/api/v1/rules/${homework.id}/pause`, admin, { askId: waiting.id }), groupParams(homework.id));
    expect(ruleWide.status).toBe(400);
    expect((await prisma().ask.findUniqueOrThrow({ where: { id: waiting.id } })).state).toBe("waiting");
  });

  it("limits asks to a few an hour", async () => {
    await verb(pauseRoute, "pause", admin, emma.id, "internet");
    await prisma().ask.createMany({
      data: Array.from({ length: ASKS_PER_HOUR }, () => ({ groupId: emma.id, about: "pause", state: "timedOut" as const, expiresAt: new Date() })),
    });
    const many = await ask(child, emma.id, { about: "pause" });
    expect(many.status).toBe(429);
    expect(await errorCode(many)).toBe("too_many_asks");
  });

  it("is answered yes by any write that lifts what it asks about", async () => {
    await verb(pauseRoute, "pause", admin, emma.id, "internet");
    const paused = await askOf(await ask(child, emma.id, { about: "pause" }));
    expect((await unblockRoute(post(`/api/v1/groups/${emma.id}/unblock`, admin, {}), groupParams(emma.id))).status).toBe(200);
    expect((await readGroup(admin, emma.id)).ask).toMatchObject({ id: paused.id, state: "yes" });

    const homework = await windowRule(emma.id);
    const windowAsk = await askOf(await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes: 30 }));
    // Pausing the rule for everyone lifts it for Emma as well.
    expect((await rulePauseRoute(post(`/api/v1/rules/${homework.id}/pause`, admin, {}), groupParams(homework.id))).status).toBe(200);
    expect((await readGroup(admin, emma.id)).ask).toMatchObject({ id: windowAsk.id, state: "yes" });
  });

  it("closes an ask nobody answered: with its block when that ends first, else when the household's timeout passes", async () => {
    await verb(pauseRoute, "pause", admin, emma.id, "internet", { until: new Date(Date.now() + 10 * MINUTE).toISOString() });
    const short = await askOf(await ask(child, emma.id, { about: "pause" }));
    const pauseEnd = await prisma().rule.findFirstOrThrow({ where: { systemGroupId: emma.id } });
    expect(short.expiresAt).toBe(pauseEnd.expiresAt!.toISOString());
    // Read past its end, before any sweep, it is already closed.
    await prisma().ask.update({ where: { id: short.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await readGroup(child, emma.id)).ask).toMatchObject({ id: short.id, state: "ended" });
    expect((await readGroup(child, emma.id)).ask!.expiresAt).toBeUndefined();

    await verb(pauseRoute, "pause", admin, emma.id, "internet");
    const open = await askOf(await ask(child, emma.id, { about: "pause" }));
    await prisma().ask.update({ where: { id: open.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await readGroup(admin, emma.id)).ask).toMatchObject({ id: open.id, state: "timedOut" });
    await closeLapsedAsks(new Date());
    expect((await prisma().ask.findMany({ orderBy: { createdAt: "asc" } })).map((row) => row.state)).toEqual(["ended", "timedOut"]);
    // A week on, both are gone.
    await closeLapsedAsks(new Date(Date.now() + 8 * 24 * 60 * MINUTE));
    expect(await prisma().ask.count()).toBe(0);
  });

  it("names no one to the child when the recovery account answers", async () => {
    await verb(pauseRoute, "pause", admin, emma.id, "internet");
    const waiting = await askOf(await ask(child, emma.id, { about: "pause" }));
    await liftGroupRule(await adminSession(), "resume", { groupId: emma.id, ruleId: "internet" }, { askId: waiting.id });
    expect((await readGroup(admin, emma.id)).ask).toMatchObject({ state: "yes", by: { name: "Recovery admin" } });
    expect((await readGroup(child, emma.id)).ask).toMatchObject({ state: "yes", by: null });
  });

  it("answers by id only for a parent, and only while the window it asks about is on", async () => {
    const homework = await windowRule(emma.id);
    const waiting = await askOf(await ask(child, emma.id, { about: "rule", ruleId: homework.id, minutes: 30 }));
    const parent = await adminSession();
    for (const device of [{ clientType: "app-watch", scope: "app:rulesOnly" }, { clientType: "agent", scope: "agent:full" }]) {
      await expect(liftGroupRule({ ...parent, device }, "allow", { groupId: emma.id, ruleId: homework.id }, { askId: waiting.id })).rejects.toMatchObject({ status: 403 });
    }
    // The window was moved to later since the child asked: a yes by id would have no end, so it is refused and the ask left waiting.
    await prisma().ruleWindow.updateMany({ where: { ruleId: homework.id }, data: { start: hhmm(new Date(Date.now() + 3 * 60 * MINUTE)), end: hhmm(new Date(Date.now() + 4 * 60 * MINUTE)) } });
    await expect(liftGroupRule(parent, "allow", { groupId: emma.id, ruleId: homework.id }, { askId: waiting.id, until: null })).rejects.toMatchObject({ status: 409 });
    expect((await prisma().ask.findUniqueOrThrow({ where: { id: waiting.id } })).state).toBe("waiting");
  });

  it("follows a pause set again or extended, so a waiting ask is not closed while the child is still paused", async () => {
    await verb(pauseRoute, "pause", admin, emma.id, "internet", { until: new Date(Date.now() + 10 * MINUTE).toISOString() });
    const waiting = await askOf(await ask(child, emma.id, { about: "pause" }));
    expect(Date.parse(waiting.expiresAt!) - Date.parse(waiting.at)).toBeLessThanOrEqual(10 * MINUTE);
    const extendRoute = (await import("@/app/api/v1/groups/[id]/rules/[ruleId]/extend/route")).POST;
    expect((await verb(extendRoute, "extend", admin, emma.id, "internet", { minutes: 120 })).status).toBe(200);
    const moved = (await readGroup(child, emma.id)).ask!;
    // Now the household's hour comes first.
    expect(Date.parse(moved.expiresAt!) - Date.parse(moved.at)).toBe(60 * MINUTE);
    expect((await prisma().ask.findUniqueOrThrow({ where: { id: waiting.id } })).endsWithBlock).toBe(false);
  });

  it("keeps the household's timeout and wait in its settings, within bounds", async () => {
    const put = (body: unknown) => putHousehold(request("/api/v1/settings/household", { method: "PUT", auth: admin, headers: json, body: JSON.stringify(body) }));
    const saved = await put({ askTimeoutMinutes: 15, askWaitMinutes: 0 });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { household: Record<string, unknown> }).household).toMatchObject({ askTimeoutMinutes: 15, askWaitMinutes: 0 });
    for (const body of [{ askTimeoutMinutes: 4 }, { askTimeoutMinutes: 1441 }, { askWaitMinutes: -1 }]) expect((await put(body)).status, JSON.stringify(body)).toBe(400);
  });
});
