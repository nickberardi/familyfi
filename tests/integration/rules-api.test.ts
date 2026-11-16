/**
 * Household rules: optional internet rules with several named windows covering several
 * groups, category schedules without an internet rule (US-5–US-7), website rules (#94),
 * policy names that follow the rule (#101), and the pause and allowance a parent uses on
 * top of them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as createRuleRoute } from "@/app/api/v1/rules/route";
import { DELETE as deleteRuleRoute, GET as getRuleRoute, PATCH as patchRuleRoute } from "@/app/api/v1/rules/[id]/route";
import { prisma } from "@/server/db";
import { liftGroupRule } from "@/server/group-internet";
import { readUnblockBody, unblockGroup as unblockGroupFn, type UnblockAction } from "@/server/group-unblock";
import { deleteGroup as deleteGroupFn, getGroup as getGroupFn } from "@/server/groups";
import { getHouseholdSettings, updateHouseholdSettings } from "@/server/household";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { deleteRule as deleteRuleFn, liftRule, readLiftBody, switchRule, updateRule, type LiftAction } from "@/server/rule-lifts";
import { createRule, getRule as getRuleFn, listRules as listRulesFn, RuleCreateBody, RuleUpdateBody } from "@/server/rules";
import type { Rule } from "@/lib/rules";
import { getSharedDevMockClient, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { setLockDnsResolverForTests } from "@/server/unifi/lock-dns";
import type { FirewallPolicy } from "@/server/unifi/types";
import { answered, documented } from "../helpers/answered";
import { authFromLogin, request } from "../helpers/http";
import { adminSession } from "../helpers/session";
import { INTERNAL_ZONE, configureConnectedHousehold, resetDatabase, seedDevice } from "../helpers/db";
import { fixtureUnifiClient, policyMacs } from "../helpers/unifi-world";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const MAC = "02:00:00:00:00:01";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

type PublicRule = {
  id: string;
  name: string;
  kind: string;
  groupIds: string[];
  domains: string[];
  blockPrivateRelay: boolean;
  openDns: { source: string; name: string | null; host: string | null; addresses: string[] }[];
  mode: string;
  enabled: boolean;
  pause: { active: boolean; until: string | null; kind: string; by: { name: string } | null };
  groupPauses: { groupId: string; pause: { active: boolean; until: string | null; kind: string } }[];
  windows: { id: string; name: string; days: number[]; start: string; end: string }[];
  policyNames: string[];
  builtIn: string | null;
};
type PublicGroup = {
  access: string;
  internetRuleIds: string[];
  suspension: { active: boolean; until: string | null; by: { name: string } | null };
  allowance: { active: boolean; until: string | null; by: { name: string } | null };
};

async function signedIn() {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

const json = { "content-type": "application/json" };

/** Who the cases act as: set for each test, once the database is reset. */
let session: Awaited<ReturnType<typeof adminSession>>;

/** Creates a rule. A body the request schema refuses goes through the route, whose refusal that is. */
async function postRule(body: object) {
  const parsed = RuleCreateBody.safeParse(body);
  if (parsed.success) return answered("POST /api/v1/rules", () => createRule(parsed.data), 201);
  return createRuleRoute(request("/api/v1/rules", { method: "POST", auth: await signedIn(), headers: json, body: JSON.stringify(body) }));
}

async function patch(id: string, body: object) {
  const parsed = RuleUpdateBody.safeParse(body);
  if (parsed.success) return answered("PATCH /api/v1/rules/{id}", () => updateRule(session, id, parsed.data));
  return patchRuleRoute(request(`/api/v1/rules/${id}`, { method: "PATCH", auth: await signedIn(), headers: json, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

/** A verb's body as its route reads it: `readLiftBody` is the server's own reader. */
function sent(body: string | undefined) {
  return request("/api/v1/x", { method: "POST", headers: json, body });
}

/** The group's built-in `internet` rule: pause blocks all internet, allow overrides its internet rules. */
const pause = "pause";
const resume = "resume";
const allow = "allow";
const disallow = "disallow";
/** The same verbs under the names the cases use for a rule and for one group's rule, and the rule's switch. */
const [pauseRule, resumeRule, extendRule, allowRule, disallowRule] = ["pause", "resume", "extend", "allow", "disallow"] as const;
const [pauseGroupRule, resumeGroupRule, extendGroupRule, allowGroupRule, disallowGroupRule] = ["pause", "resume", "extend", "allow", "disallow"] as const;
const [turnOnRule, turnOffRule] = ["on", "off"] as const;
const [unblockGroup, endGroupUnblock, extendGroupUnblock] = ["unblock", "end", "extend"] as const;

async function groupAction(action: LiftAction, id: string, body = "{}") {
  return groupRuleBody(action, id, "internet", body);
}

async function groupRuleBody(action: LiftAction, groupId: string, ruleId: string, body: string | undefined) {
  const read = await readLiftBody(sent(body), action);
  if (!read.ok) return documented(`POST /api/v1/groups/{id}/rules/{ruleId}/${action}`, read.response);
  return answered(`POST /api/v1/groups/{id}/rules/{ruleId}/${action}`, () => liftGroupRule(session, action, { groupId, ruleId }, read.body));
}

async function ruleAction(action: LiftAction | "on" | "off", id: string, body: object | null = {}) {
  if (action === "on" || action === "off") return answered(`POST /api/v1/rules/{id}/${action}`, () => switchRule(session, id, action === "on"));
  const read = await readLiftBody(sent(body === null ? undefined : JSON.stringify(body)), action);
  if (!read.ok) return documented(`POST /api/v1/rules/{id}/${action}`, read.response);
  return answered(`POST /api/v1/rules/{id}/${action}`, () => liftRule(session, action, { ruleId: id }, read.body));
}

async function groupRuleAction(action: LiftAction, groupId: string, ruleId: string, body: object | null = {}) {
  return groupRuleBody(action, groupId, ruleId, body === null ? undefined : JSON.stringify(body));
}

async function unblockAction(action: UnblockAction, id: string, body: object | null = null) {
  const read = await readUnblockBody(sent(body === null ? undefined : JSON.stringify(body)), action);
  const operation = `POST /api/v1/groups/{id}/unblock${action === "unblock" ? "" : `/${action}`}` as const;
  if (!read.ok) return documented(operation, read.response);
  return answered(operation, () => unblockGroupFn(session, action, id, read.body));
}

const listRules = (groupId?: string) => answered("GET /api/v1/rules", async () => ({ rules: await listRulesFn(groupId) }));
const getRule = (id: string) => answered("GET /api/v1/rules/{id}", async () => ({ rule: await getRuleFn(id) }));
const deleteRule = (id: string) => answered("DELETE /api/v1/rules/{id}", () => deleteRuleFn(id));
const deleteGroup = (id: string) => answered("DELETE /api/v1/groups/{id}", async () => ({ ok: true, ...(await deleteGroupFn(id)) }));

async function ruleOf(response: Response): Promise<PublicRule> {
  return ((await response.json()) as { rule: PublicRule }).rule;
}

async function errorCode(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

async function readGroup(id: string): Promise<PublicGroup> {
  return ((await (await answered("GET /api/v1/groups/{id}", async () => ({ group: await getGroupFn(id) }))).json()) as { group: PublicGroup }).group;
}

/** HH:MM in UTC, `minutes` from now: a window around now, whatever time the test runs. */
function utcClock(minutes: number) {
  const at = new Date(Date.now() + minutes * 60_000);
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
}

async function child(name = "Emma") {
  const group = await prisma().group.create({ data: { kind: GroupKind.family, name, familyRole: FamilyRole.child } });
  await seedDevice({ mac: MAC, groupId: group.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
  return group;
}

/** Every device a rule's policies name, whichever zone's policy holds it. */
function macsNamed(client: ReturnType<typeof fixtureUnifiClient>, prefix: string): string[] {
  return policiesNamed(client, prefix).flatMap((policy) => policyMacs(policy)).sort();
}

function policiesNamed(client: ReturnType<typeof fixtureUnifiClient>, prefix: string): FirewallPolicy[] {
  return client.state.policies.filter((policy) => policy.name.startsWith(prefix));
}

describe("household rules", () => {
  let client: ReturnType<typeof fixtureUnifiClient>;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC" } });
    client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    session = await adminSession();
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
    delete process.env.FAMILYFI_MODE;
    resetDevMockClientForTests();
  });

  it("schedules several no-internet windows for several groups, one policy per window", async () => {
    const emma = await child();
    const sister = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
    await seedDevice({ mac: "02:00:00:00:00:02", groupId: sister.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });

    const created = await postRule({
      name: "School days",
      kind: "internet",
      groupIds: [emma.id, sister.id],
      mode: "scheduled",
      windows: [
        { name: "Homework", days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" },
        { name: "Bedtime", days: EVERY_DAY, start: "22:00", end: "06:00" },
      ],
    });
    expect(created.status).toBe(201);
    const { rule } = (await created.json()) as { rule: PublicRule };
    expect(rule.groupIds).toEqual([emma.id, sister.id].sort());
    expect(rule.policyNames).toEqual(["FamilyFi School days – Homework", "FamilyFi School days – Bedtime"]);

    await runReconcileOnce();
    // One policy per window in each zone the groups' devices are in; Ava's tablet is on IoT.
    const policies = policiesNamed(client, "FamilyFi School days");
    expect(policies.map((policy) => [policy.name, policy.schedule?.timeFilter, policyMacs(policy)])).toEqual([
      ["FamilyFi School days – Homework", { startTime: "15:00", stopTime: "18:00" }, ["02:00:00:00:00:01"]],
      ["FamilyFi School days – Bedtime", { startTime: "22:00", stopTime: "06:00" }, ["02:00:00:00:00:01"]],
      ["FamilyFi School days – Homework (IoT)", { startTime: "15:00", stopTime: "18:00" }, ["02:00:00:00:00:02"]],
      ["FamilyFi School days – Bedtime (IoT)", { startTime: "22:00", stopTime: "06:00" }, ["02:00:00:00:00:02"]],
    ]);
    expect((await readGroup(emma.id)).internetRuleIds).toEqual([rule.id]);
  });

  it("deletes a rule's or a group's gateway policies a few at a time, not one after another", async () => {
    const emma = await child();
    const sister = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
    await seedDevice({ mac: "02:00:00:00:00:02", groupId: sister.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
    const windows = ["06:00", "09:00", "12:00"].map((start, index) => ({ name: `W${index}`, days: EVERY_DAY, start, end: `${String(index * 3 + 7).padStart(2, "0")}:00` }));
    const both = await ruleOf(await postRule({ name: "Both", kind: "internet", groupIds: [emma.id, sister.id], mode: "scheduled", windows }));
    await ruleOf(await postRule({ name: "Hers", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows }));
    await runReconcileOnce();

    // In test mode the server reaches the console through the shared mock, once a key is stored.
    // Each delete is held until a second one is in flight, so overlap shows however fast the
    // ownership queries are; deletes made one after another wait out the fallback and fail on peak.
    process.env.FAMILYFI_MODE = "test";
    await prisma().household.update({
      where: { id: "default" },
      data: { unifiKeyCiphertext: Buffer.from([1]), unifiKeyIv: Buffer.from([1]), unifiKeyAuthTag: Buffer.from([1]) },
    });
    const gateway = getSharedDevMockClient();
    const deleted: string[] = [];
    let inFlight = 0;
    let peak = 0;
    let open = () => {};
    let overlap = Promise.resolve();
    const hold = () => {
      overlap = new Promise<void>((done) => (open = done));
    };
    hold();
    gateway.deletePolicy = async (_siteId: string, id: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (inFlight >= 2) open();
      await Promise.race([overlap, new Promise((done) => setTimeout(done, 5_000))]);
      inFlight -= 1;
      deleted.push(id);
    };
    const bothIds = (await prisma().rulePolicy.findMany({ where: { ruleId: both.id } })).map((policy) => policy.unifiPolicyId);
    expect(bothIds).toHaveLength(6);
    await deleteRule(both.id);
    expect(deleted.sort()).toEqual([...bothIds].sort());
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);

    deleted.length = 0;
    peak = 0;
    hold();
    expect(await prisma().rulePolicy.count()).toBe(3);
    await deleteGroup(emma.id);
    expect(deleted).toHaveLength(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("renames a rule's policies in place and adds and removes windows by id (#101)", async () => {
    const emma = await child();
    const created = await postRule({
      name: "Bedtime",
      kind: "internet",
      groupIds: [emma.id],
      mode: "scheduled",
      windows: [{ days: EVERY_DAY, start: "21:00", end: "07:00" }],
    });
    const { rule } = (await created.json()) as { rule: PublicRule };
    await runReconcileOnce();
    const [original] = policiesNamed(client, "FamilyFi Bedtime");
    expect(original?.name).toBe("FamilyFi Bedtime");

    const renamed = await patch(rule.id, {
      name: "Kids – lights out",
      windows: [
        { id: rule.windows[0]!.id, name: "School nights", days: [0, 1, 2, 3, 4], start: "21:00", end: "07:00" },
        { name: "Weekend", days: [5, 6], start: "23:00", end: "08:00" },
      ],
    });
    expect(renamed.status).toBe(200);
    await runReconcileOnce();
    const kept = client.state.policies.find((policy) => policy.id === original!.id);
    expect(kept?.name).toBe("FamilyFi Kids – lights out – School nights");
    expect((kept?.schedule as { repeatOnDays?: string[] } | undefined)?.repeatOnDays).toEqual(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"]);
    expect(policiesNamed(client, "FamilyFi Kids – lights out").map((policy) => policy.name)).toEqual([
      "FamilyFi Kids – lights out – School nights",
      "FamilyFi Kids – lights out – Weekend",
    ]);

    // Dropping the first window deletes its policy; the one left takes the rule's name.
    const current = ((await renamed.json()) as { rule: PublicRule }).rule;
    await patch(rule.id, { windows: [current.windows[1]] });
    await runReconcileOnce();
    expect(client.state.policies.some((policy) => policy.id === original!.id)).toBe(false);
    expect(policiesNamed(client, "FamilyFi Kids").map((policy) => policy.name)).toEqual(["FamilyFi Kids – lights out"]);

    const generated = await patch(rule.id, { useGeneratedName: true });
    expect(((await generated.json()) as { rule: PublicRule }).rule.policyNames).toEqual([`FamilyFi Rule ${rule.id.slice(-4).toUpperCase()}`]);
  });

  it("filters Video on a TV group on a schedule with no internet rule (US-5–US-7)", async () => {
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
    await seedDevice({ mac: MAC, groupId: tv.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
    const created = await postRule({
      name: "TV video evenings",
      kind: "category",
      groupIds: [tv.id],
      targetIds: [4],
      mode: "scheduled",
      windows: [
        { name: "After school", days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" },
        { name: "Late", days: EVERY_DAY, start: "21:00", end: "23:00" },
      ],
    });
    expect(created.status).toBe(201);
    await runReconcileOnce();

    const group = await readGroup(tv.id);
    expect(group.internetRuleIds).toEqual([]);
    expect(group.access).toBe("available");
    // Only the Video policies: nothing blocks the TV's other traffic.
    const ours = client.state.policies.filter((policy) => policyMacs(policy).includes(MAC));
    expect(ours.map((policy) => [policy.name, policy.destination.trafficFilter?.type])).toEqual([
      ["FamilyFi TV video evenings – After school", "APPLICATION_CATEGORY"],
      ["FamilyFi TV video evenings – Late", "APPLICATION_CATEGORY"],
    ]);

    // Adding and then removing an internet rule leaves the Video schedule as it was.
    const internet = await postRule({
      name: "TV downtime",
      kind: "internet",
      groupIds: [tv.id],
      mode: "scheduled",
      windows: [{ days: EVERY_DAY, start: "23:00", end: "07:00" }],
    });
    const { rule } = (await internet.json()) as { rule: PublicRule };
    await deleteRule(rule.id);
    await runReconcileOnce();
    expect(await prisma().rule.count({ where: { kind: "category" } })).toBe(1);
    expect(client.state.policies.filter((policy) => policyMacs(policy).includes(MAC)).map((policy) => policy.name)).toEqual([
      "FamilyFi TV video evenings – After school",
      "FamilyFi TV video evenings – Late",
    ]);
  });

  it("blocks websites and their subdomains for a group (#94)", async () => {
    const emma = await child();
    const invalid = await postRule({ name: "No TikTok", kind: "domain", groupIds: [emma.id], domains: ["not a site"], mode: "always" });
    expect(invalid.status).toBe(400);

    const created = await postRule({
      name: "No TikTok",
      kind: "domain",
      groupIds: [emma.id],
      domains: ["https://www.TikTok.com/foryou", "tiktokcdn.com", "tiktokcdn.com"],
      mode: "always",
    });
    expect(created.status).toBe(201);
    const website = ((await created.json()) as { rule: PublicRule }).rule;
    expect(website.domains).toEqual(["tiktokcdn.com", "www.tiktok.com"]);
    // Only what describes a website rule, always on, for groups: no targetIds, windows or networkIds.
    for (const field of ["targetIds", "windows", "networkIds", "countries", "blockPrivateRelay", "openDns"]) expect(website).not.toHaveProperty(field);
    await runReconcileOnce();
    const [policy] = policiesNamed(client, "FamilyFi No TikTok");
    expect(policy?.destination.trafficFilter).toEqual({
      type: "DOMAIN",
      domainFilter: { type: "DOMAINS", domains: ["tiktokcdn.com", "www.tiktok.com"] },
    });
    expect(policy?.schedule).toBeFalsy();
  });

  it("rejects rules that are not complete", async () => {
    const emma = await child();
    const window = { days: EVERY_DAY, start: "21:00", end: "07:00" };
    const cases: [object, number, string][] = [
      [{ name: "No windows", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows: [] }, 400, "invalid_schedule"],
      [{ name: " ", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows: [window] }, 400, "invalid_name"],
      [{ name: "Nobody", kind: "internet", groupIds: [], mode: "scheduled", windows: [window] }, 400, "invalid_groups"],
      [{ name: "Same time", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows: [{ ...window, end: "21:00" }] }, 400, "invalid_schedule"],
      [{ name: "Video", kind: "category", groupIds: [emma.id], mode: "always" }, 400, "invalid_targets"],
      [{ name: "Networks", kind: "internet", scope: "network", networkIds: ["x"], mode: "scheduled", windows: [window] }, 400, "invalid_scope"],
    ];
    for (const [body, status, code] of cases) {
      const response = await postRule(body);
      expect([response.status, ((await response.json()) as { error: { code: string } }).error.code], JSON.stringify(body)).toEqual([status, code]);
    }
    // Only the built-in quarantine, Lock DNS and Block countries rules remain.
    expect(await prisma().rule.count()).toBe(3);
  });

  it("pauses all internet with its own unscheduled policy, and removes it on resume", async () => {
    const emma = await child();
    const paused = await groupAction(pause, emma.id);
    expect(paused.status).toBe(200);
    const body = ((await paused.json()) as { group: PublicGroup }).group;
    expect(body.access).toBe("paused");
    expect(body.suspension.by?.name).toBe("Recovery admin");

    await runReconcileOnce();
    const [policy] = policiesNamed(client, "FamilyFi Emma's Internet Pause");
    expect(policy?.enabled).toBe(true);
    expect(policy?.schedule).toBeFalsy();
    expect(policy?.destination.trafficFilter).toBeUndefined();
    expect(policyMacs(policy!)).toEqual([MAC]);

    await groupAction(resume, emma.id);
    await runReconcileOnce();
    expect(client.state.policies.some((item) => item.id === policy!.id)).toBe(false);
    expect((await readGroup(emma.id)).suspension).toEqual({ active: false, until: null, by: null });
  });

  it("allows a group online until the active window ends, keeping its category rules", async () => {
    const emma = await child();
    // Nothing is blocking yet, so there is nothing to allow.
    expect((await groupAction(allow, emma.id)).status).toBe(409);

    await postRule({
      name: "Homework",
      kind: "internet",
      groupIds: [emma.id],
      mode: "scheduled",
      windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
    });
    await postRule({ name: "Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" });
    await runReconcileOnce();
    expect((await readGroup(emma.id)).access).toBe("blocked");
    const [homework] = policiesNamed(client, "FamilyFi Homework");
    expect(homework?.enabled).toBe(true);

    const allowed = await groupAction(allow, emma.id);
    expect(allowed.status).toBe(200);
    const group = ((await allowed.json()) as { group: PublicGroup }).group;
    expect(group.access).toBe("allowed");
    const until = new Date(group.allowance.until!).getTime();
    expect(Math.abs(until - (Date.now() + 60 * 60_000))).toBeLessThan(2 * 60_000);

    await runReconcileOnce();
    // Emma is the rule's only member, so its policy stays with her device but disabled.
    expect(client.state.policies.find((policy) => policy.id === homework!.id)?.enabled).toBe(false);
    expect(policiesNamed(client, "FamilyFi Video")[0]?.enabled).toBe(true);

    await groupAction(disallow, emma.id);
    await runReconcileOnce();
    expect(client.state.policies.find((policy) => policy.id === homework!.id)?.enabled).toBe(true);
    expect((await readGroup(emma.id)).access).toBe("blocked");
  });

  it("blocks all internet always for chosen groups, never a whole network, and an allowance lifts it until resumed", async () => {
    const emma = await child();
    // All internet for a whole network would take every device offline.
    const network = await postRule({ name: "Everyone", kind: "internet", scope: "network", networkIds: ["x"], mode: "always" });
    expect([network.status, ((await network.json()) as { error: { code: string } }).error.code]).toEqual([400, "invalid_scope"]);

    const created = await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
    expect(created.status).toBe(201);
    const grounded = ((await created.json()) as { rule: PublicRule }).rule;
    expect(grounded.policyNames).toEqual(["FamilyFi Grounded"]);
    expect(grounded).toMatchObject({ groupIds: [emma.id], groupPauses: [] });
    for (const field of ["targetIds", "domains", "windows", "networkIds"]) expect(grounded).not.toHaveProperty(field);
    await runReconcileOnce();
    const [policy] = policiesNamed(client, "FamilyFi Grounded");
    expect(policy?.enabled).toBe(true);
    expect(policy?.schedule).toBeFalsy();
    expect(policyMacs(policy!)).toEqual([MAC]);
    const blocked = await readGroup(emma.id);
    expect(blocked.access).toBe("blocked");
    expect(blocked.internetRuleIds).toHaveLength(1);

    // The rule never ends, so by default the allowance lasts until someone resumes the schedule.
    const allowed = await groupAction(allow, emma.id);
    expect(allowed.status).toBe(200);
    const group = ((await allowed.json()) as { group: PublicGroup }).group;
    expect([group.access, group.allowance.active, group.allowance.until]).toEqual(["allowed", true, null]);
    await runReconcileOnce();
    expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(false);

    await groupAction(disallow, emma.id);
    await runReconcileOnce();
    expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
  });

  it("lets a pause replace an allowance", async () => {
    const emma = await child();
    await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
    await groupAction(allow, emma.id, JSON.stringify({ until: null }));
    const paused = await groupAction(pause, emma.id);
    const group = ((await paused.json()) as { group: PublicGroup }).group;
    expect(group.allowance).toEqual({ active: false, until: null, by: null });
    expect(group.access).toBe("paused");
  });

  describe("rule pause, resume, extend and allow", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    /** A Video rule and a bedtime rule for one child, reconciled onto the gateway. */
    async function videoAndBedtime() {
      const emma = await child();
      const video = await ruleOf(await postRule({ name: "TV Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" }));
      const bedtime = await ruleOf(
        await postRule({
          name: "Homework",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
        }),
      );
      await runReconcileOnce();
      return { emma, video, bedtime };
    }

    it("lifts a rule until a time and puts it back on resume, leaving its policies in place", async () => {
      const { video } = await videoAndBedtime();
      const [policy] = policiesNamed(client, "FamilyFi TV Video");
      expect(policy?.enabled).toBe(true);

      const until = inMinutes(30);
      const paused = await ruleOf(await ruleAction(pauseRule, video.id, { until: until.toISOString() }));
      expect(paused.pause).toEqual({ active: true, until: until.toISOString(), kind: "pause", by: { accountId: expect.anything(), name: "Recovery admin" } });
      expect(paused.enabled).toBe(true);
      await runReconcileOnce();
      const lifted = client.state.policies.find((item) => item.id === policy!.id);
      expect([lifted?.enabled, policyMacs(lifted!)]).toEqual([false, [MAC]]);

      const extended = await ruleOf(await ruleAction(extendRule, video.id, { minutes: 15 }));
      expect(new Date(extended.pause.until!).getTime()).toBe(until.getTime() + 15 * 60_000);

      const resumed = await ruleOf(await ruleAction(resumeRule, video.id, null));
      expect(resumed.pause).toEqual({ active: false, until: null, kind: "pause", by: null });
      await runReconcileOnce();
      expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
      expect(policiesNamed(client, "FamilyFi TV Video")).toHaveLength(1);
    });

    it("lets an indefinite pause run until resumed", async () => {
      const { video } = await videoAndBedtime();
      const paused = await ruleOf(await ruleAction(pauseRule, video.id));
      expect([paused.pause.active, paused.pause.until]).toEqual([true, null]);
      expect(await errorCode(await ruleAction(extendRule, video.id, { minutes: 15 }))).toEqual([409, "indefinite"]);
    });

    it("allows a rule until its active window ends, and an always-on rule until resumed", async () => {
      const { emma, video, bedtime } = await videoAndBedtime();
      const allowed = await ruleOf(await ruleAction(allowRule, bedtime.id));
      expect(Math.abs(new Date(allowed.pause.until!).getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      await runReconcileOnce();
      expect(policiesNamed(client, "FamilyFi Homework")[0]?.enabled).toBe(false);
      // The group's own state no longer counts the lifted bedtime as blocking.
      expect((await readGroup(emma.id)).access).toBe("available");

      const always = await ruleOf(await ruleAction(allowRule, video.id));
      expect([always.pause.active, always.pause.until]).toEqual([true, null]);
    });

    it("refuses to allow a rule that is not blocking, unless given a time", async () => {
      const emma = await child();
      const later = await ruleOf(
        await postRule({
          name: "Later",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
        }),
      );
      expect(await errorCode(await ruleAction(allowRule, later.id))).toEqual([409, "not_in_window"]);
      const explicit = await ruleAction(allowRule, later.id, { until: inMinutes(30).toISOString() });
      expect(explicit.status).toBe(200);
    });

    it("answers 409 for a rule that is off, or a pause that is not there to extend", async () => {
      const { video } = await videoAndBedtime();
      expect(await errorCode(await ruleAction(extendRule, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);

      await ruleAction(pauseRule, video.id);
      const off = await ruleOf(await ruleAction(turnOffRule, video.id, null));
      // Off and paused never overlap: turning a rule off ends its pause.
      expect([off.enabled, off.pause.active]).toEqual([false, false]);
      for (const handler of [pauseRule, allowRule]) {
        expect(await errorCode(await ruleAction(handler, video.id))).toEqual([409, "rule_off"]);
      }
      expect(await errorCode(await ruleAction(extendRule, video.id, { minutes: 15 }))).toEqual([409, "rule_off"]);
      // Resume always succeeds.
      expect((await ruleAction(resumeRule, video.id, null)).status).toBe(200);

      const on = await ruleOf(await ruleAction(turnOnRule, video.id, null));
      expect(on.enabled).toBe(true);
    });

    it("rejects a pause that ends in the past, and unknown rules", async () => {
      const { video } = await videoAndBedtime();
      expect(await errorCode(await ruleAction(pauseRule, video.id, { until: inMinutes(-5).toISOString() }))).toEqual([400, "invalid_request"]);
      expect((await ruleAction(pauseRule, "missing")).status).toBe(404);
    });

    it("cannot be set by editing a rule, and turning a rule off through an edit ends the pause", async () => {
      const { video } = await videoAndBedtime();
      const rejected = await patch(video.id, { pause: { active: true, until: null, by: null } });
      expect(rejected.status).toBe(400);
      await ruleAction(pauseRule, video.id);
      const edited = await ruleOf(await patch(video.id, { name: "TV Video 2" }));
      expect(edited.pause.active).toBe(true);
      const off = await ruleOf(await patch(video.id, { enabled: false }));
      expect(off.pause.active).toBe(false);
    });

    it("clears an expired pause on the next tick", async () => {
      const { video } = await videoAndBedtime();
      await ruleAction(pauseRule, video.id, { until: inMinutes(30).toISOString() });
      await prisma().rule.update({ where: { id: video.id }, data: { pauseUntil: inMinutes(-1) } });
      await runReconcileOnce();
      const stored = await prisma().rule.findUniqueOrThrow({ where: { id: video.id } });
      expect([stored.pauseActive, stored.pauseUntil, stored.pausedByName]).toEqual([false, null, null]);
      expect(policiesNamed(client, "FamilyFi TV Video")[0]?.enabled).toBe(true);
    });

    it("makes a paused internet rule not blocking, so allowing the group is refused", async () => {
      const { emma, bedtime } = await videoAndBedtime();
      expect((await readGroup(emma.id)).access).toBe("blocked");
      await ruleAction(pauseRule, bedtime.id);
      const group = await readGroup(emma.id);
      expect([group.access, group.internetRuleIds]).toEqual(["available", [bedtime.id]]);
      expect((await groupAction(allow, emma.id)).status).toBe(409);
      // A group's own pause still blocks while its rule is paused.
      await groupAction(pause, emma.id);
      expect((await readGroup(emma.id)).access).toBe("paused");
    });
  });

  describe("pause and allowance are told apart, and either can apply to one group", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    /** Two children in one Video rule, one device each, reconciled onto the gateway. */
    async function twoChildren() {
      const emma = await child();
      const ava = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
      await seedDevice({ mac: "02:00:00:00:00:02", groupId: ava.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
      const video = await ruleOf(await postRule({ name: "TV Video", kind: "category", groupIds: [emma.id, ava.id], targetIds: [4], mode: "always" }));
      await runReconcileOnce();
      return { emma, ava, video };
    }

    it("ends only the kind it names: resume a pause, disallow an allowance", async () => {
      const { video } = await twoChildren();

      const allowed = await ruleOf(await ruleAction(allowRule, video.id));
      expect([allowed.pause.active, allowed.pause.kind]).toEqual([true, "allow"]);
      expect((await ruleOf(await ruleAction(resumeRule, video.id, null))).pause.active).toBe(true);
      expect(await errorCode(await ruleAction(extendRule, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);
      expect((await ruleOf(await ruleAction(disallowRule, video.id, null))).pause).toMatchObject({ active: false, until: null, kind: "pause" });

      const paused = await ruleOf(await ruleAction(pauseRule, video.id));
      expect([paused.pause.active, paused.pause.kind]).toEqual([true, "pause"]);
      expect((await ruleOf(await ruleAction(disallowRule, video.id, null))).pause.active).toBe(true);
      expect((await ruleOf(await ruleAction(resumeRule, video.id, null))).pause.active).toBe(false);
      // Ending what is not there still succeeds.
      expect((await ruleAction(disallowRule, video.id, null)).status).toBe(200);
    });

    it("lifts a rule for one group: its devices leave the policy and the others stay", async () => {
      const { emma, video } = await twoChildren();
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);

      const until = inMinutes(30);
      const paused = await ruleOf(await groupRuleAction(pauseGroupRule, emma.id, video.id, { until: until.toISOString() }));
      expect(paused.pause.active).toBe(false);
      expect(paused.groupPauses).toEqual([{ groupId: emma.id, pause: expect.objectContaining({ active: true, kind: "pause", until: until.toISOString() }) }]);
      await runReconcileOnce();
      // Ava's policy still blocks; Emma is alone in hers, so it keeps her device but is disabled.
      const live = policiesNamed(client, "FamilyFi TV Video").filter((item) => item.enabled);
      expect(live.flatMap((item) => policyMacs(item))).toEqual(["02:00:00:00:00:02"]);
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);

      const extended = await ruleOf(await groupRuleAction(extendGroupRule, emma.id, video.id, { minutes: 15 }));
      expect(new Date(extended.groupPauses[0]!.pause.until!).getTime()).toBe(until.getTime() + 15 * 60_000);

      const resumed = await ruleOf(await groupRuleAction(resumeGroupRule, emma.id, video.id, null));
      expect(resumed.groupPauses).toEqual([]);
      await runReconcileOnce();
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);
    });

    it("disables a policy that has no one left, keeping its devices, and re-enables it on disallow", async () => {
      const emma = await child();
      const video = await ruleOf(await postRule({ name: "TV Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" }));
      await runReconcileOnce();
      const [policy] = policiesNamed(client, "FamilyFi TV Video");

      const allowed = await ruleOf(await groupRuleAction(allowGroupRule, emma.id, video.id));
      expect(allowed.groupPauses[0]?.pause).toMatchObject({ active: true, kind: "allow", until: null });
      await runReconcileOnce();
      const off = client.state.policies.find((item) => item.id === policy!.id);
      expect([off?.enabled, policyMacs(off!)]).toEqual([false, [MAC]]);

      await groupRuleAction(disallowGroupRule, emma.id, video.id, null);
      await runReconcileOnce();
      expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
      expect(policiesNamed(client, "FamilyFi TV Video")).toHaveLength(1);
    });

    it("lets a group's internet rule stop counting as blocking for that group alone", async () => {
      const emma = await child();
      const ava = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
      const homework = await ruleOf(
        await postRule({
          name: "Homework",
          kind: "internet",
          groupIds: [emma.id, ava.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
        }),
      );
      expect([(await readGroup(emma.id)).access, (await readGroup(ava.id)).access]).toEqual(["blocked", "blocked"]);
      const allowed = await ruleOf(await groupRuleAction(allowGroupRule, emma.id, homework.id));
      expect(Math.abs(new Date(allowed.groupPauses[0]!.pause.until!).getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      expect([(await readGroup(emma.id)).access, (await readGroup(ava.id)).access]).toEqual(["allowed", "blocked"]);
    });

    it("answers 404 for a group that does not have the rule, 409 for a rule that is off, and 409 without a window", async () => {
      const { emma, video } = await twoChildren();
      const stranger = await prisma().group.create({ data: { kind: GroupKind.family, name: "Stranger", familyRole: FamilyRole.child } });
      expect(await errorCode(await groupRuleAction(pauseGroupRule, stranger.id, video.id))).toEqual([404, "not_found"]);
      expect(await errorCode(await groupRuleAction(pauseGroupRule, emma.id, "missing"))).toEqual([404, "not_found"]);
      expect(await errorCode(await groupRuleAction(extendGroupRule, emma.id, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);

      await ruleAction(turnOffRule, video.id, null);
      expect(await errorCode(await groupRuleAction(pauseGroupRule, emma.id, video.id))).toEqual([409, "rule_off"]);
      await ruleAction(turnOnRule, video.id, null);

      const later = await ruleOf(
        await postRule({
          name: "Later",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
        }),
      );
      expect(await errorCode(await groupRuleAction(allowGroupRule, emma.id, later.id))).toEqual([409, "not_in_window"]);
    });

    it("clears an expired group lift on the next tick, and keeps a lift through an edit", async () => {
      const { emma, video } = await twoChildren();
      await groupRuleAction(pauseGroupRule, emma.id, video.id, { until: inMinutes(30).toISOString() });
      const edited = await ruleOf(await patch(video.id, { name: "TV Video 2" }));
      expect(edited.groupPauses).toHaveLength(1);
      await prisma().ruleGroup.update({ where: { ruleId_groupId: { ruleId: video.id, groupId: emma.id } }, data: { pauseUntil: inMinutes(-1) } });
      await runReconcileOnce();
      const link = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: video.id, groupId: emma.id } } });
      expect([link.pauseActive, link.pauseUntil, link.pausedByName]).toEqual([false, null, null]);
    });
  });

  describe("a group's unblock", () => {
    const OTHER_MAC = "02:00:00:00:00:02";
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    /** The devices the rule's enabled policies still block. */
    function blockedMacs(prefix: string): string[] {
      return policiesNamed(client, prefix).filter((policy) => policy.enabled).flatMap((policy) => policyMacs(policy)).sort();
    }

    async function liftOf(ruleId: string, groupId: string) {
      return prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId, groupId } } });
    }

    it("lifts every kind of rule blocking the group now, for it alone, until each window ends", async () => {
      const emma = await child();
      const noah = await prisma().group.create({ data: { kind: GroupKind.family, name: "Noah", familyRole: FamilyRole.child } });
      await seedDevice({ mac: OTHER_MAC, groupId: noah.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
      expect(await errorCode(await unblockAction(unblockGroup, emma.id))).toEqual([409, "not_blocked"]);

      const homework = await ruleOf(await postRule({
        name: "Homework",
        kind: "internet",
        groupIds: [emma.id],
        mode: "scheduled",
        windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
      }));
      const video = await ruleOf(await postRule({
        name: "Video",
        kind: "category",
        groupIds: [emma.id, noah.id],
        targetIds: [4],
        mode: "scheduled",
        windows: [{ days: EVERY_DAY, start: utcClock(-30), end: utcClock(30) }],
      }));
      const later = await ruleOf(await postRule({
        name: "Gaming",
        kind: "category",
        groupIds: [emma.id],
        targetIds: [8],
        mode: "scheduled",
        windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
      }));
      await runReconcileOnce();
      expect(blockedMacs("FamilyFi Video")).toEqual([MAC, OTHER_MAC].sort());

      const unblocked = await unblockAction(unblockGroup, emma.id);
      expect(unblocked.status).toBe(200);
      const body = (await unblocked.json()) as { group: PublicGroup; rules: Rule[] };
      expect(body.group.access).toBe("allowed");
      // Each of the group's rules comes back with its lift for the group, so a client can show it.
      expect(body.rules.map((rule) => rule.name).sort()).toEqual(["Gaming", "Homework", "Video"]);
      expect(body.rules.find((rule) => rule.id === video.id)!.groupPauses).toEqual([
        expect.objectContaining({ groupId: emma.id, pause: expect.objectContaining({ active: true, kind: "allow" }) }),
      ]);
      const homeworkLift = await liftOf(homework.id, emma.id);
      const videoLift = await liftOf(video.id, emma.id);
      expect([homeworkLift.pauseKind, videoLift.pauseKind]).toEqual(["allow", "allow"]);
      expect(Math.abs(homeworkLift.pauseUntil!.getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      expect(Math.abs(videoLift.pauseUntil!.getTime() - inMinutes(30).getTime())).toBeLessThan(2 * 60_000);
      // A rule not blocking now is left to start on time; the rule is unchanged for everyone else.
      expect((await liftOf(later.id, emma.id)).pauseActive).toBe(false);
      expect((await liftOf(video.id, noah.id)).pauseActive).toBe(false);
      expect((await prisma().rule.findUniqueOrThrow({ where: { id: video.id } })).pauseActive).toBe(false);

      await runReconcileOnce();
      expect(blockedMacs("FamilyFi Video")).toEqual([OTHER_MAC]);

      // More time counts from the unblock's end, the latest allowance, and every allowance ends then.
      const extended = await unblockAction(extendGroupUnblock, emma.id, { minutes: 15 });
      expect(extended.status).toBe(200);
      const target = homeworkLift.pauseUntil!.getTime() + 15 * 60_000;
      expect((await liftOf(homework.id, emma.id)).pauseUntil!.getTime()).toBe(target);
      expect((await liftOf(video.id, emma.id)).pauseUntil!.getTime()).toBe(target);

      const ended = await unblockAction(endGroupUnblock, emma.id);
      expect(ended.status).toBe(200);
      expect(((await ended.json()) as { group: PublicGroup }).group.access).toBe("blocked");
      await runReconcileOnce();
      expect(blockedMacs("FamilyFi Video")).toEqual([MAC, OTHER_MAC].sort());
    });

    it("given a time, lifts every rule the group has, ends its pause, and extends together", async () => {
      const emma = await child();
      const later = await ruleOf(await postRule({
        name: "Gaming",
        kind: "category",
        groupIds: [emma.id],
        targetIds: [8],
        mode: "scheduled",
        windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
      }));
      const extend = (minutes: number) => unblockAction(extendGroupUnblock, emma.id, { minutes });
      expect(await errorCode(await extend(15))).toEqual([409, "not_unblocked"]);
      await groupAction(pause, emma.id);

      const until = inMinutes(240);
      const unblocked = await unblockAction(unblockGroup, emma.id, { until: until.toISOString() });
      expect(unblocked.status).toBe(200);
      expect(((await unblocked.json()) as { group: PublicGroup }).group.suspension.active).toBe(false);
      expect((await liftOf(later.id, emma.id)).pauseUntil?.getTime()).toBe(until.getTime());

      expect((await extend(15)).status).toBe(200);
      expect((await liftOf(later.id, emma.id)).pauseUntil?.getTime()).toBe(until.getTime() + 15 * 60_000);
      expect(await errorCode(await unblockAction(unblockGroup, emma.id, { until: inMinutes(-5).toISOString() }))).toEqual([400, "invalid_request"]);
    });

    it("leaves an always-on category, app or website rule on, but lifts an always-on internet rule", async () => {
      const emma = await child();
      const tiktok = await ruleOf(await postRule({ name: "No TikTok", kind: "domain", groupIds: [emma.id], domains: ["tiktok.com"], mode: "always" }));
      // How the group is set up is not a block on it: alone, there is nothing to unblock.
      expect(await errorCode(await unblockAction(unblockGroup, emma.id))).toEqual([409, "not_blocked"]);

      const grounded = await ruleOf(await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" }));
      expect((await unblockAction(unblockGroup, emma.id)).status).toBe(200);
      expect((await liftOf(grounded.id, emma.id)).pauseKind).toBe("allow");
      expect((await liftOf(tiktok.id, emma.id)).pauseActive).toBe(false);

      // Given a time, every other rule is lifted, but not this one.
      await groupAction(pause, emma.id);
      expect((await unblockAction(unblockGroup, emma.id, { until: inMinutes(60).toISOString() })).status).toBe(200);
      expect((await liftOf(tiktok.id, emma.id)).pauseActive).toBe(false);
    });

    it("ends the group's own pause even when no rule blocks it", async () => {
      const emma = await child();
      await groupAction(pause, emma.id);
      const unblocked = await unblockAction(unblockGroup, emma.id);
      expect(unblocked.status).toBe(200);
      expect(((await unblocked.json()) as { group: PublicGroup }).group.access).toBe("available");
      expect(await errorCode(await unblockAction(unblockGroup, "missing"))).toEqual([404, "not_found"]);
    });
  });

  describe("a group's built-in internet rule", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    it("blocks with a hidden rule that exists on the gateway only while paused, and no rule is needed", async () => {
      const auth = await signedIn();
      const emma = await child();
      const paused = await groupAction(pause, emma.id);
      expect(paused.status).toBe(200);
      const group = ((await paused.json()) as { group: PublicGroup }).group;
      expect([group.access, group.internetRuleIds]).toEqual(["paused", []]);
      expect(group.suspension).toMatchObject({ active: true, until: null, by: { name: "Recovery admin" } });

      // The rule that carries it is not a household rule: hidden, and not editable or deletable.
      const block = await prisma().rule.findFirstOrThrow({ where: { systemGroupId: emma.id } });
      const listed = (await (await listRules()).json()) as { rules: { id: string }[] };
      expect(listed.rules.map((rule) => rule.id)).toEqual(["quarantine", "dns", "countries"]);
      for (const handler of [getRuleRoute, patchRuleRoute, deleteRuleRoute]) {
        const method = handler === getRuleRoute ? "GET" : handler === patchRuleRoute ? "PATCH" : "DELETE";
        const response = await handler(request(`/api/v1/rules/${block.id}`, { method, auth, headers: { "content-type": "application/json" }, body: method === "PATCH" ? "{}" : undefined }), {
          params: Promise.resolve({ id: block.id }),
        });
        expect(response.status, method).toBe(404);
      }
      expect(await errorCode(await ruleAction(pauseRule, block.id))).toEqual([404, "not_found"]);

      await runReconcileOnce();
      const [policy] = policiesNamed(client, "FamilyFi Emma's Internet Pause");
      expect([policy?.enabled, policyMacs(policy!)]).toEqual([true, [MAC]]);

      await groupAction(resume, emma.id);
      await runReconcileOnce();
      expect(client.state.policies.some((item) => item.id === policy!.id)).toBe(false);
      expect((await readGroup(emma.id)).suspension).toEqual({ active: false, until: null, by: null });
    });

    it("ends a timed pause by itself on the next tick, and extends one that has an end", async () => {
      const emma = await child();
      expect(await errorCode(await groupRuleAction(extendGroupRule, emma.id, "internet", { minutes: 15 }))).toEqual([409, "not_paused"]);
      await groupAction(pause, emma.id);
      expect(await errorCode(await groupRuleAction(extendGroupRule, emma.id, "internet", { minutes: 15 }))).toEqual([409, "indefinite"]);

      const until = inMinutes(30);
      await groupAction(pause, emma.id, JSON.stringify({ until: until.toISOString() }));
      const extended = (await (await groupRuleAction(extendGroupRule, emma.id, "internet", { minutes: 15 })).json()) as { group: PublicGroup };
      expect(new Date(extended.group.suspension.until!).getTime()).toBe(until.getTime() + 15 * 60_000);
      expect(await errorCode(await groupAction(pause, emma.id, JSON.stringify({ until: inMinutes(-5).toISOString() })))).toEqual([400, "invalid_request"]);

      await prisma().rule.updateMany({ where: { systemGroupId: emma.id }, data: { expiresAt: inMinutes(-1) } });
      await runReconcileOnce();
      expect((await readGroup(emma.id)).suspension.active).toBe(false);
      expect(policiesNamed(client, "FamilyFi Emma's Internet Pause")).toEqual([]);
    });

    it("overrides the group's internet rules with allow, and lets a pause and an allow replace each other", async () => {
      const emma = await child();
      // Nothing limits the group, so there is nothing to override.
      expect(await errorCode(await groupAction(allow, emma.id))).toEqual([409, "not_in_window"]);
      expect((await groupAction(disallow, emma.id)).status).toBe(200);

      const homework = await ruleOf(
        await postRule({
          name: "Homework",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
        }),
      );
      await runReconcileOnce();
      const allowed = ((await (await groupAction(allow, emma.id)).json()) as { group: PublicGroup }).group;
      expect(allowed.access).toBe("allowed");
      expect(Math.abs(new Date(allowed.allowance.until!).getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      const link = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: homework.id, groupId: emma.id } } });
      expect([link.pauseActive, link.pauseKind]).toEqual([true, "allow"]);

      const paused = ((await (await groupAction(pause, emma.id)).json()) as { group: PublicGroup }).group;
      expect([paused.access, paused.allowance.active]).toEqual(["paused", false]);
      const again = ((await (await groupAction(allow, emma.id, "{}")).json()) as { group: PublicGroup }).group;
      // The pause is over and the rule is lifted again; the rule is not blocking now, so allow is refused only when none is.
      expect([again.access, again.suspension.active]).toEqual(["allowed", false]);

      const ended = ((await (await groupAction(disallow, emma.id)).json()) as { group: PublicGroup }).group;
      expect(ended.access).toBe("blocked");
      // Resume ends a pause only, and disallow an allowance only.
      await groupAction(pause, emma.id);
      await groupAction(disallow, emma.id);
      expect((await readGroup(emma.id)).access).toBe("paused");
    });

    it("leaves no block policy on the gateway once a paused group is deleted", async () => {
      const emma = await child();
      await groupAction(pause, emma.id);
      await runReconcileOnce();
      expect(policiesNamed(client, "FamilyFi Emma's Internet Pause")).toHaveLength(1);

      const deleted = await deleteGroup(emma.id);
      expect(deleted.status).toBe(200);
      // The delete goes through the household's own client; the next pass clears anything the fixture gateway kept.
      await runReconcileOnce();
      expect(policiesNamed(client, "FamilyFi Emma's Internet Pause")).toEqual([]);
      expect(await prisma().rule.count({ where: { systemGroupId: { not: null } } })).toBe(0);
    });

    it("gives an allowance a new time when allowed again", async () => {
      const emma = await child();
      await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
      await groupAction(allow, emma.id, JSON.stringify({ until: inMinutes(30).toISOString() }));
      const later = inMinutes(90);
      const again = ((await (await groupAction(allow, emma.id, JSON.stringify({ until: later.toISOString() }))).json()) as { group: PublicGroup }).group;
      expect(again.allowance.until).toBe(later.toISOString());
    });
  });

  describe("the built-in Lock DNS rule", () => {
    const lockDnsPolicies = () => policiesNamed(client, "FamilyFi Lock DNS");
    const names = () => lockDnsPolicies().map((policy) => policy.name).sort();

    it("starts off with no group, and covers every person when switched on", async () => {
      const emma = await child();
      const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
      const listed = (await (await listRules()).json()) as { rules: PublicRule[] };
      const lockDns = listed.rules.find((rule) => rule.id === "dns")!;
      expect(lockDns).toMatchObject({ builtIn: "dns", kind: "domain", mode: "always", enabled: false, groupIds: [] });
      expect(lockDns.domains).toContain("cloudflare-dns.com");
      expect(lockDns.policyNames).toEqual(["FamilyFi Lock DNS", "FamilyFi Lock DNS services", "FamilyFi Lock DNS services IPv6", "FamilyFi Lock DNS names"]);
      await runReconcileOnce();
      expect(lockDnsPolicies()).toEqual([]);

      const on = await ruleOf(await ruleAction(turnOnRule, "dns", null));
      expect([on.enabled, on.groupIds]).toEqual([true, [emma.id]]);
      expect(on.groupIds).not.toContain(tv.id);
      await runReconcileOnce();
      expect(names()).toEqual(["FamilyFi Lock DNS", "FamilyFi Lock DNS names", "FamilyFi Lock DNS services", "FamilyFi Lock DNS services IPv6"]);
      expect(lockDnsPolicies().every((policy) => policy.enabled && policyMacs(policy).join() === MAC)).toBe(true);
      const ports = lockDnsPolicies().find((policy) => policy.name === "FamilyFi Lock DNS")!;
      expect(ports.destination.trafficFilter).toMatchObject({ type: "PORT", portFilter: { items: [{ value: 53 }, { value: 853 }] } });

      // Off keeps the policies, disabled; on again keeps the groups it had.
      await ruleAction(turnOffRule, "dns", null);
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => !policy.enabled)).toBe(true);
      const again = await ruleOf(await patch("dns", { enabled: true }));
      expect(again.groupIds).toEqual([emma.id]);

      // Covering no group, its policies go, each by the id FamilyFi recorded for it.
      await runReconcileOnce();
      const recorded = (await prisma().rulePolicy.findMany({ where: { ruleId: "dns" } })).map((row) => row.unifiPolicyId).sort();
      expect(recorded).toEqual(lockDnsPolicies().map((policy) => policy.id).sort());
      await patch("dns", { groupIds: [] });
      await runReconcileOnce();
      expect(lockDnsPolicies()).toEqual([]);
      expect(await prisma().rulePolicy.count({ where: { ruleId: "dns" } })).toBe(0);
    });

    it("takes only its groups and switch, and cannot be deleted", async () => {
      const emma = await child();
      const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
      const picked = await ruleOf(await patch("dns", { groupIds: [tv.id, emma.id] }));
      expect(picked.groupIds).toEqual([emma.id, tv.id].sort());
      expect(picked.enabled).toBe(false);
      // Switched on with groups already picked, it keeps them.
      expect((await ruleOf(await ruleAction(turnOnRule, "dns", null))).groupIds).toEqual([emma.id, tv.id].sort());
      expect((await ruleOf(await patch("dns", { groupIds: [emma.id], enabled: true }))).groupIds).toEqual([emma.id]);
      // Groups named with the switch are the ones it covers, even none.
      expect((await ruleOf(await patch("dns", { groupIds: [], enabled: true }))).groupIds).toEqual([]);
      await patch("dns", { groupIds: [emma.id] });

      expect(await errorCode(await patch("dns", { name: "Loose" }))).toEqual([409, "rule_built_in"]);
      expect(await errorCode(await patch("dns", { groupIds: [emma.id], domains: ["example.com"] }))).toEqual([409, "rule_built_in"]);
      expect(await errorCode(await patch("dns", {}))).toEqual([409, "rule_built_in"]);
      expect(await errorCode(await patch("dns", { groupIds: ["missing"] }))).toEqual([404, "not_found"]);
      const deleted = await deleteRule("dns");
      expect(await errorCode(deleted)).toEqual([409, "rule_built_in"]);
      const stored = await prisma().rule.findUniqueOrThrow({ where: { id: "dns" }, include: { groups: true } });
      expect([stored.name, stored.groups.map((link) => link.groupId)]).toEqual(["Lock DNS", [emma.id]]);
    });

    it("pauses for everyone and allows one group like any rule, but a group's unblock leaves it on", async () => {
      const emma = await child();
      await ruleAction(turnOnRule, "dns", null);
      await runReconcileOnce();

      await ruleAction(pauseRule, "dns", { until: new Date(Date.now() + 30 * 60_000).toISOString() });
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => !policy.enabled)).toBe(true);
      await ruleAction(resumeRule, "dns", null);
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => policy.enabled)).toBe(true);

      // A group's unblock lifts what blocks it, which Lock DNS never does.
      await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
      const unblocked = await unblockAction(unblockGroup, emma.id, { until: new Date(Date.now() + 30 * 60_000).toISOString() });
      expect(unblocked.status).toBe(200);
      const link = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: "dns", groupId: emma.id } } });
      expect(link.pauseActive).toBe(false);
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => policy.enabled && policyMacs(policy).join() === MAC)).toBe(true);

      // An allowance for the group takes its devices out; ending the group's unblock keeps it.
      const allowed = await ruleOf(await groupRuleAction(allowGroupRule, emma.id, "dns", { until: null }));
      expect(allowed.groupPauses).toMatchObject([{ groupId: emma.id, pause: { active: true, kind: "allow" } }]);
      await unblockAction(endGroupUnblock, emma.id);
      expect((await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: "dns", groupId: emma.id } } })).pauseActive).toBe(true);
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => !policy.enabled && policyMacs(policy).join() === MAC)).toBe(true);
    });

    it("turns off iCloud Private Relay with one more policy while its switch is on", async () => {
      await child();
      await ruleAction(turnOnRule, "dns", null);
      const on = await ruleOf(await patch("dns", { blockPrivateRelay: true }));
      expect(on.blockPrivateRelay).toBe(true);
      expect(on.policyNames.at(-1)).toBe("FamilyFi Lock DNS Private Relay");
      await runReconcileOnce();
      const relay = lockDnsPolicies().find((policy) => policy.name === "FamilyFi Lock DNS Private Relay")!;
      expect(relay.destination.trafficFilter).toEqual({ type: "DOMAIN", domainFilter: { type: "DOMAINS", domains: ["mask-h2.icloud.com", "mask.icloud.com"] } });
      expect(policyMacs(relay).join()).toBe(MAC);
      expect(lockDnsPolicies()).toHaveLength(5);

      // Off again, only its own policy goes.
      const others = lockDnsPolicies().filter((policy) => policy.id !== relay.id).map((policy) => policy.id).sort();
      await patch("dns", { blockPrivateRelay: false });
      await runReconcileOnce();
      expect(lockDnsPolicies().map((policy) => policy.id).sort()).toEqual(others);

      // Only Lock DNS has the switch.
      const rule = await ruleOf(await postRule({ name: "Videos", kind: "domain", groupIds: [(await prisma().group.findFirstOrThrow()).id], mode: "always", domains: ["example.com"] }));
      expect(await errorCode(await patch(rule.id, { blockPrivateRelay: true }))).toEqual([400, "invalid_request"]);
      expect(await errorCode(await patch("countries", { blockPrivateRelay: true }))).toEqual([409, "rule_built_in"]);
    });

    it("leaves the household's own DNS servers and resolvers alone", async () => {
      await child();
      for (const network of client.state.networks) {
        network.ipv4Configuration!.dhcpConfiguration = { mode: "SERVER", dnsServerIpAddressesOverride: ["1.1.1.3", "1.0.0.3"] };
      }
      await prisma().household.update({ where: { id: "default" }, data: { dohUrl: "https://dns11.quad9.net/dns-query" } });
      setLockDnsResolverForTests(async () => ["9.9.9.11", "149.112.112.11"]);
      try {
        await ruleAction(turnOnRule, "dns", null);
        await runReconcileOnce();
        const policy = (name: string) => lockDnsPolicies().find((item) => item.name === name)!;
        expect(policy("FamilyFi Lock DNS").destination.trafficFilter).toMatchObject({
          type: "IP_ADDRESS",
          ipAddressFilter: { matchOpposite: true, items: ["1.0.0.3", "1.1.1.3", "149.112.112.11", "9.9.9.11"].map((value) => ({ type: "IP_ADDRESS", value })) },
          portFilter: { items: [{ value: 53 }, { value: 853 }] },
        });
        const v4 = JSON.stringify(policy("FamilyFi Lock DNS services").destination.trafficFilter);
        expect([v4.includes('"1.1.1.1"'), v4.includes('"1.1.1.3"'), v4.includes('"9.9.9.11"')]).toEqual([true, false, false]);
        const names = JSON.stringify(policy("FamilyFi Lock DNS names").destination.trafficFilter);
        expect([names.includes('"dns.quad9.net"'), names.includes('"dns11.quad9.net"')]).toEqual([true, false]);

        // Its page lists what it left open, by where each comes from.
        const listed = (await (await listRules()).json()) as { rules: PublicRule[] };
        expect(listed.rules.find((rule) => rule.id === "dns")!.openDns).toEqual([
          ...client.state.networks
            .filter((network) => network.enabled !== false && network.ipv4Configuration?.dhcpConfiguration?.mode === "SERVER")
            .map((network) => ({ source: "network", name: network.name, host: null, addresses: ["1.0.0.3", "1.1.1.3"] })),
          { source: "household", name: null, host: "dns11.quad9.net", addresses: ["149.112.112.11", "9.9.9.11"] },
        ]);
        expect(listed.rules.find((rule) => rule.id !== "dns")?.openDns ?? []).toEqual([]);

        // Nothing changed, so the next pass writes nothing, to the gateway or to the rule.
        const stored = (await prisma().rule.findUniqueOrThrow({ where: { id: "dns" } })).updatedAt;
        client.calls.length = 0;
        await runReconcileOnce();
        expect(client.calls.filter((call) => call.method !== "GET")).toEqual([]);
        expect((await prisma().rule.findUniqueOrThrow({ where: { id: "dns" } })).updatedAt).toEqual(stored);
      } finally {
        setLockDnsResolverForTests(undefined);
      }
    });

    it("keeps its policies as they are while a network's DNS servers cannot be read", async () => {
      await child();
      for (const network of client.state.networks) {
        network.ipv4Configuration!.dhcpConfiguration = { mode: "SERVER", dnsServerIpAddressesOverride: ["1.1.1.3"] };
      }
      await ruleAction(turnOnRule, "dns", null);
      await runReconcileOnce();
      const before = JSON.stringify(lockDnsPolicies());
      expect(before).toContain('"matchOpposite":true');

      // Each network's own read fails, so only its overview is known.
      const getNetwork = client.getNetwork;
      client.getNetwork = async () => {
        throw new Error("gateway busy");
      };
      try {
        await ruleAction(turnOffRule, "dns", null);
        await runReconcileOnce();
        expect(JSON.stringify(lockDnsPolicies())).toBe(before);
        // Not applied: the pass says so, and the next one tries again.
        const run = await prisma().syncRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
        expect([run.status, run.error]).toEqual(["partial", "Lock DNS kept as it was: a network's DNS settings could not be read."]);
      } finally {
        client.getNetwork = getNetwork;
      }
      await runReconcileOnce();
      expect(lockDnsPolicies().every((policy) => !policy.enabled)).toBe(true);
    });

    it("stays when the only group it covers is deleted, and its policies go", async () => {
      const emma = await child();
      await ruleAction(turnOnRule, "dns", null);
      await runReconcileOnce();
      expect(lockDnsPolicies()).toHaveLength(4);

      const deleted = await deleteGroup(emma.id);
      expect(deleted.status).toBe(200);
      const stored = await prisma().rule.findUniqueOrThrow({ where: { id: "dns" }, include: { groups: true } });
      expect([stored.enabled, stored.groups]).toEqual([true, []]);
      await runReconcileOnce();
      expect(lockDnsPolicies()).toEqual([]);
    });
  });

  describe("the built-in quarantine rule", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const quarantinePolicy = () => policiesNamed(client, "FamilyFi Quarantine")[0];
    const enforced = async () =>
      (await getHouseholdSettings()).quarantineEnforced;

    /** Quarantine on, holding the fixture gateway's unassigned client. */
    async function quarantining() {
      const on = await ruleOf(await ruleAction(turnOnRule, "quarantine", null));
      await runReconcileOnce();
      return on;
    }

    it("leads the rule list, covers no group, and switches quarantine itself", async () => {
      const emma = await child();
      await postRule({ name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
      const listed = (await (await listRules()).json()) as { rules: PublicRule[] };
      expect(listed.rules.map((rule) => [rule.name, rule.builtIn])).toEqual([
        ["Quarantine", "quarantine"],
        ["Lock DNS", "dns"],
        ["Block countries", "countries"],
        ["Grounded", null],
      ]);
      const [quarantine] = listed.rules;
      expect(quarantine).toMatchObject({ id: "quarantine", kind: "internet", mode: "always", enabled: false });
      expect(quarantine).not.toHaveProperty("groupIds");
      expect(quarantine).not.toHaveProperty("groupPauses");
      expect(quarantine!.policyNames).toEqual(["FamilyFi Quarantine Internal Devices"]);
      // A group's own list leaves it out.
      const scoped = (await (await listRules(emma.id)).json()) as { rules: PublicRule[] };
      expect(scoped.rules.map((rule) => rule.name)).toEqual(["Grounded"]);

      const on = await quarantining();
      expect(on.enabled).toBe(true);
      expect(await enforced()).toBe(true);
      expect(quarantinePolicy()?.enabled).toBe(true);
      expect(policyMacs(quarantinePolicy()!).length).toBeGreaterThan(0);
      // Nor does it plan a policy of its own beside the quarantine policy.
      expect(await prisma().rulePolicy.count({ where: { ruleId: "quarantine" } })).toBe(0);

      const off = await ruleOf(await patch("quarantine", { enabled: false }));
      expect(off.enabled).toBe(false);
      expect(await enforced()).toBe(false);
      await runReconcileOnce();
      expect(quarantinePolicy()?.enabled).toBe(false);
    });

    it("cannot be edited, deleted or allowed", async () => {
      await quarantining();
      expect(await errorCode(await patch("quarantine", { name: "Loose" }))).toEqual([409, "rule_built_in"]);
      expect(await errorCode(await patch("quarantine", { enabled: true, name: "Loose" }))).toEqual([409, "rule_built_in"]);
      const deleted = await deleteRule("quarantine");
      expect(await errorCode(deleted)).toEqual([409, "rule_built_in"]);
      for (const handler of [allowRule, disallowRule]) {
        expect(await errorCode(await ruleAction(handler, "quarantine"))).toEqual([409, "rule_built_in"]);
      }
      const stored = await prisma().rule.findUniqueOrThrow({ where: { id: "quarantine" } });
      expect([stored.name, stored.pauseActive]).toEqual(["Quarantine", false]);
    });

    it("pauses, extends and resumes like any rule, disabling its policies meanwhile", async () => {
      await quarantining();
      const policies = policiesNamed(client, "FamilyFi Quarantine");
      const state = () =>
        policies.map((policy) => {
          const live = client.state.policies.find((item) => item.id === policy.id);
          return [live?.enabled, live ? policyMacs(live) : null];
        });
      expect(state()).toEqual(policies.map((policy) => [true, policyMacs(policy)]));

      const until = inMinutes(30);
      const paused = await ruleOf(await ruleAction(pauseRule, "quarantine", { until: until.toISOString() }));
      expect(paused.pause).toMatchObject({ active: true, until: until.toISOString(), kind: "pause", by: { name: "Recovery admin" } });
      expect(paused.enabled).toBe(true);
      await runReconcileOnce();
      // Disabled in place, keeping their devices; quarantine itself stays on.
      expect(state()).toEqual(policies.map((policy) => [false, policyMacs(policy)]));
      expect(await enforced()).toBe(true);

      const extended = await ruleOf(await ruleAction(extendRule, "quarantine", { minutes: 15 }));
      expect(new Date(extended.pause.until!).getTime()).toBe(until.getTime() + 15 * 60_000);

      const resumed = await ruleOf(await ruleAction(resumeRule, "quarantine", null));
      expect(resumed.pause.active).toBe(false);
      await runReconcileOnce();
      expect(state()).toEqual(policies.map((policy) => [true, policyMacs(policy)]));
      expect(policiesNamed(client, "FamilyFi Quarantine")).toHaveLength(policies.length);
    });

    it("blocks again when its pause expires", async () => {
      await quarantining();
      await ruleAction(pauseRule, "quarantine", { until: inMinutes(30).toISOString() });
      await runReconcileOnce();
      expect(quarantinePolicy()?.enabled).toBe(false);
      await prisma().rule.update({ where: { id: "quarantine" }, data: { pauseUntil: inMinutes(-1) } });
      await runReconcileOnce();
      expect((await prisma().rule.findUniqueOrThrow({ where: { id: "quarantine" } })).pauseActive).toBe(false);
      expect(quarantinePolicy()?.enabled).toBe(true);
    });

    it("never brings back a pause that raced turning it off, and keeps one when saved on again", async () => {
      await quarantining();
      await ruleOf(await ruleAction(turnOffRule, "quarantine", null));
      // A pause that read quarantine as on just before it went off lands afterwards.
      await prisma().rule.update({ where: { id: "quarantine" }, data: { pauseActive: true, pauseUntil: null } });
      const on = await ruleOf(await ruleAction(turnOnRule, "quarantine", null));
      expect([on.enabled, on.pause.active]).toEqual([true, false]);
      await runReconcileOnce();
      expect(quarantinePolicy()?.enabled).toBe(true);

      await ruleAction(pauseRule, "quarantine");
      const saved = await answered("PUT /api/v1/settings/household", () => updateHouseholdSettings({ quarantineEnforced: true, displayName: "Home" }));
      expect(saved.status).toBe(200);
      expect((await prisma().rule.findUniqueOrThrow({ where: { id: "quarantine" } })).pauseActive).toBe(true);
    });

    it("refuses a pause while quarantine is off, and turning it off in Settings ends a pause", async () => {
      expect(await errorCode(await ruleAction(pauseRule, "quarantine"))).toEqual([409, "rule_off"]);
      await quarantining();
      await ruleAction(pauseRule, "quarantine");
      const put = await answered("PUT /api/v1/settings/household", () => updateHouseholdSettings({ quarantineEnforced: false }));
      expect(put.status).toBe(200);
      const rule = await ruleOf(await getRule("quarantine"));
      expect([rule.enabled, rule.pause.active]).toEqual([false, false]);
    });
  });
});
