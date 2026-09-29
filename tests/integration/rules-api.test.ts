/**
 * Household rules: optional internet rules with several named windows covering several
 * groups, category schedules without an internet rule (US-5–US-7), website rules (#94),
 * policy names that follow the rule (#101), and the pause and allowance a parent uses on
 * top of them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as pause } from "@/app/api/v1/groups/[id]/pause/route";
import { POST as resume } from "@/app/api/v1/groups/[id]/resume/route";
import { DELETE as disallow, POST as allow } from "@/app/api/v1/groups/[id]/allow/route";
import { POST as createRule } from "@/app/api/v1/rules/route";
import { POST as allowRule } from "@/app/api/v1/rules/[id]/allow/route";
import { POST as disallowRule } from "@/app/api/v1/rules/[id]/disallow/route";
import { POST as extendRule } from "@/app/api/v1/rules/[id]/extend/route";
import { POST as allowGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/allow/route";
import { POST as extendGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/extend/route";
import { POST as pauseGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as resumeGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { POST as disallowGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/disallow/route";
import { POST as turnOffRule } from "@/app/api/v1/rules/[id]/off/route";
import { POST as turnOnRule } from "@/app/api/v1/rules/[id]/on/route";
import { POST as pauseRule } from "@/app/api/v1/rules/[id]/pause/route";
import { POST as resumeRule } from "@/app/api/v1/rules/[id]/resume/route";
import { DELETE as deleteRule, PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import type { FirewallPolicy } from "@/server/unifi/types";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
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
  mode: string;
  enabled: boolean;
  pause: { active: boolean; until: string | null; kind: string; by: { name: string } | null };
  groupPauses: { groupId: string; pause: { active: boolean; until: string | null; kind: string } }[];
  windows: { id: string; name: string; days: number[]; start: string; end: string }[];
  policyNames: string[];
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

async function postRule(auth: SessionAuth, body: object) {
  return createRule(
    request("/api/v1/rules", { method: "POST", auth, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

async function patch(auth: SessionAuth, id: string, body: object) {
  return patchRule(
    request(`/api/v1/rules/${id}`, { method: "PATCH", auth, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

async function groupAction(handler: typeof pause, auth: SessionAuth, id: string, method = "POST", body = "{}") {
  return handler(
    request(`/api/v1/groups/${id}/x`, { method, auth, headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : body }),
    { params: Promise.resolve({ id }) },
  );
}

async function ruleAction(handler: typeof pauseRule, auth: SessionAuth, id: string, body: object | null = {}) {
  return handler(
    request(`/api/v1/rules/${id}/x`, { method: "POST", auth, headers: { "content-type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

async function groupRuleAction(handler: typeof pauseGroupRule, auth: SessionAuth, groupId: string, ruleId: string, body: object | null = {}) {
  return handler(
    request(`/api/v1/groups/${groupId}/rules/${ruleId}/x`, { method: "POST", auth, headers: { "content-type": "application/json" }, body: body === null ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id: groupId, ruleId }) },
  );
}

async function ruleOf(response: Response): Promise<PublicRule> {
  return ((await response.json()) as { rule: PublicRule }).rule;
}

async function errorCode(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

async function readGroup(auth: SessionAuth, id: string): Promise<PublicGroup> {
  const response = await getGroup(request(`/api/v1/groups/${id}`, { auth }), { params: Promise.resolve({ id }) });
  return ((await response.json()) as { group: PublicGroup }).group;
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
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("schedules several no-internet windows for several groups, one policy per window", async () => {
    const auth = await signedIn();
    const emma = await child();
    const sister = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
    await seedDevice({ mac: "02:00:00:00:00:02", groupId: sister.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });

    const created = await postRule(auth, {
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
    expect((await readGroup(auth, emma.id)).internetRuleIds).toEqual([rule.id]);
  });

  it("renames a rule's policies in place and adds and removes windows by id (#101)", async () => {
    const auth = await signedIn();
    const emma = await child();
    const created = await postRule(auth, {
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

    const renamed = await patch(auth, rule.id, {
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
    await patch(auth, rule.id, { windows: [current.windows[1]] });
    await runReconcileOnce();
    expect(client.state.policies.some((policy) => policy.id === original!.id)).toBe(false);
    expect(policiesNamed(client, "FamilyFi Kids").map((policy) => policy.name)).toEqual(["FamilyFi Kids – lights out"]);

    const generated = await patch(auth, rule.id, { useGeneratedName: true });
    expect(((await generated.json()) as { rule: PublicRule }).rule.policyNames).toEqual([`FamilyFi Rule ${rule.id.slice(-4).toUpperCase()}`]);
  });

  it("filters Video on a TV group on a schedule with no internet rule (US-5–US-7)", async () => {
    const auth = await signedIn();
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
    await seedDevice({ mac: MAC, groupId: tv.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
    const created = await postRule(auth, {
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

    const group = await readGroup(auth, tv.id);
    expect(group.internetRuleIds).toEqual([]);
    expect(group.access).toBe("available");
    // Only the Video policies: nothing blocks the TV's other traffic.
    const ours = client.state.policies.filter((policy) => policyMacs(policy).includes(MAC));
    expect(ours.map((policy) => [policy.name, policy.destination.trafficFilter?.type])).toEqual([
      ["FamilyFi TV video evenings – After school", "APPLICATION_CATEGORY"],
      ["FamilyFi TV video evenings – Late", "APPLICATION_CATEGORY"],
    ]);

    // Adding and then removing an internet rule leaves the Video schedule as it was.
    const internet = await postRule(auth, {
      name: "TV downtime",
      kind: "internet",
      groupIds: [tv.id],
      mode: "scheduled",
      windows: [{ days: EVERY_DAY, start: "23:00", end: "07:00" }],
    });
    const { rule } = (await internet.json()) as { rule: PublicRule };
    await deleteRule(request(`/api/v1/rules/${rule.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: rule.id }) });
    await runReconcileOnce();
    expect(await prisma().rule.count({ where: { kind: "category" } })).toBe(1);
    expect(client.state.policies.filter((policy) => policyMacs(policy).includes(MAC)).map((policy) => policy.name)).toEqual([
      "FamilyFi TV video evenings – After school",
      "FamilyFi TV video evenings – Late",
    ]);
  });

  it("blocks websites and their subdomains for a group (#94)", async () => {
    const auth = await signedIn();
    const emma = await child();
    const invalid = await postRule(auth, { name: "No TikTok", kind: "domain", groupIds: [emma.id], domains: ["not a site"], mode: "always" });
    expect(invalid.status).toBe(400);

    const created = await postRule(auth, {
      name: "No TikTok",
      kind: "domain",
      groupIds: [emma.id],
      domains: ["https://www.TikTok.com/foryou", "tiktokcdn.com", "tiktokcdn.com"],
      mode: "always",
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { rule: PublicRule }).rule.domains).toEqual(["tiktokcdn.com", "www.tiktok.com"]);
    await runReconcileOnce();
    const [policy] = policiesNamed(client, "FamilyFi No TikTok");
    expect(policy?.destination.trafficFilter).toEqual({
      type: "DOMAIN",
      domainFilter: { type: "DOMAINS", domains: ["tiktokcdn.com", "www.tiktok.com"] },
    });
    expect(policy?.schedule).toBeFalsy();
  });

  it("rejects rules that are not complete", async () => {
    const auth = await signedIn();
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
      const response = await postRule(auth, body);
      expect([response.status, ((await response.json()) as { error: { code: string } }).error.code], JSON.stringify(body)).toEqual([status, code]);
    }
    expect(await prisma().rule.count()).toBe(0);
  });

  it("pauses all internet with its own unscheduled policy, and removes it on resume", async () => {
    const auth = await signedIn();
    const emma = await child();
    const paused = await groupAction(pause, auth, emma.id);
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

    await groupAction(resume, auth, emma.id);
    await runReconcileOnce();
    expect(client.state.policies.some((item) => item.id === policy!.id)).toBe(false);
    expect((await readGroup(auth, emma.id)).suspension).toEqual({ active: false, until: null, by: null });
  });

  it("allows a group online until the active window ends, keeping its category rules", async () => {
    const auth = await signedIn();
    const emma = await child();
    // Nothing is blocking yet, so there is nothing to allow.
    expect((await groupAction(allow, auth, emma.id)).status).toBe(409);

    await postRule(auth, {
      name: "Homework",
      kind: "internet",
      groupIds: [emma.id],
      mode: "scheduled",
      windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
    });
    await postRule(auth, { name: "Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" });
    await runReconcileOnce();
    expect((await readGroup(auth, emma.id)).access).toBe("blocked");
    const [homework] = policiesNamed(client, "FamilyFi Homework");
    expect(homework?.enabled).toBe(true);

    const allowed = await groupAction(allow, auth, emma.id);
    expect(allowed.status).toBe(200);
    const group = ((await allowed.json()) as { group: PublicGroup }).group;
    expect(group.access).toBe("allowed");
    const until = new Date(group.allowance.until!).getTime();
    expect(Math.abs(until - (Date.now() + 60 * 60_000))).toBeLessThan(2 * 60_000);

    await runReconcileOnce();
    // Emma is the rule's only member, so its policy stays with her device but disabled.
    expect(client.state.policies.find((policy) => policy.id === homework!.id)?.enabled).toBe(false);
    expect(policiesNamed(client, "FamilyFi Video")[0]?.enabled).toBe(true);

    await groupAction(disallow, auth, emma.id, "DELETE");
    await runReconcileOnce();
    expect(client.state.policies.find((policy) => policy.id === homework!.id)?.enabled).toBe(true);
    expect((await readGroup(auth, emma.id)).access).toBe("blocked");
  });

  it("blocks all internet always for chosen groups, never a whole network, and an allowance lifts it until resumed", async () => {
    const auth = await signedIn();
    const emma = await child();
    // All internet for a whole network would take every device offline.
    const network = await postRule(auth, { name: "Everyone", kind: "internet", scope: "network", networkIds: ["x"], mode: "always" });
    expect([network.status, ((await network.json()) as { error: { code: string } }).error.code]).toEqual([400, "invalid_scope"]);

    const created = await postRule(auth, { name: "Grounded", kind: "internet", groupIds: [emma.id], mode: "always" });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { rule: PublicRule }).rule.policyNames).toEqual(["FamilyFi Grounded"]);
    await runReconcileOnce();
    const [policy] = policiesNamed(client, "FamilyFi Grounded");
    expect(policy?.enabled).toBe(true);
    expect(policy?.schedule).toBeFalsy();
    expect(policyMacs(policy!)).toEqual([MAC]);
    const blocked = await readGroup(auth, emma.id);
    expect(blocked.access).toBe("blocked");
    expect(blocked.internetRuleIds).toHaveLength(1);

    // The rule never ends, so by default the allowance lasts until someone resumes the schedule.
    const allowed = await groupAction(allow, auth, emma.id);
    expect(allowed.status).toBe(200);
    const group = ((await allowed.json()) as { group: PublicGroup }).group;
    expect([group.access, group.allowance.active, group.allowance.until]).toEqual(["allowed", true, null]);
    await runReconcileOnce();
    expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(false);

    await groupAction(disallow, auth, emma.id, "DELETE");
    await runReconcileOnce();
    expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
  });

  it("lets a pause replace an allowance", async () => {
    const auth = await signedIn();
    const emma = await child();
    await groupAction(allow, auth, emma.id, "POST", JSON.stringify({ until: null }));
    const paused = await groupAction(pause, auth, emma.id);
    const group = ((await paused.json()) as { group: PublicGroup }).group;
    expect(group.allowance).toEqual({ active: false, until: null, by: null });
    expect(group.access).toBe("paused");
  });

  describe("rule pause, resume, extend and allow", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    /** A Video rule and a bedtime rule for one child, reconciled onto the gateway. */
    async function videoAndBedtime(auth: SessionAuth) {
      const emma = await child();
      const video = await ruleOf(await postRule(auth, { name: "TV Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" }));
      const bedtime = await ruleOf(
        await postRule(auth, {
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
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      const [policy] = policiesNamed(client, "FamilyFi TV Video");
      expect(policy?.enabled).toBe(true);

      const until = inMinutes(30);
      const paused = await ruleOf(await ruleAction(pauseRule, auth, video.id, { until: until.toISOString() }));
      expect(paused.pause).toEqual({ active: true, until: until.toISOString(), kind: "pause", by: { accountId: expect.anything(), name: "Recovery admin" } });
      expect(paused.enabled).toBe(true);
      await runReconcileOnce();
      const lifted = client.state.policies.find((item) => item.id === policy!.id);
      expect([lifted?.enabled, policyMacs(lifted!)]).toEqual([false, [MAC]]);

      const extended = await ruleOf(await ruleAction(extendRule, auth, video.id, { minutes: 15 }));
      expect(new Date(extended.pause.until!).getTime()).toBe(until.getTime() + 15 * 60_000);

      const resumed = await ruleOf(await ruleAction(resumeRule, auth, video.id, null));
      expect(resumed.pause).toEqual({ active: false, until: null, kind: "pause", by: null });
      await runReconcileOnce();
      expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
      expect(policiesNamed(client, "FamilyFi TV Video")).toHaveLength(1);
    });

    it("lets an indefinite pause run until resumed", async () => {
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      const paused = await ruleOf(await ruleAction(pauseRule, auth, video.id));
      expect([paused.pause.active, paused.pause.until]).toEqual([true, null]);
      expect(await errorCode(await ruleAction(extendRule, auth, video.id, { minutes: 15 }))).toEqual([409, "indefinite"]);
    });

    it("allows a rule until its active window ends, and an always-on rule until resumed", async () => {
      const auth = await signedIn();
      const { emma, video, bedtime } = await videoAndBedtime(auth);
      const allowed = await ruleOf(await ruleAction(allowRule, auth, bedtime.id));
      expect(Math.abs(new Date(allowed.pause.until!).getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      await runReconcileOnce();
      expect(policiesNamed(client, "FamilyFi Homework")[0]?.enabled).toBe(false);
      // The group's own state no longer counts the lifted bedtime as blocking.
      expect((await readGroup(auth, emma.id)).access).toBe("available");

      const always = await ruleOf(await ruleAction(allowRule, auth, video.id));
      expect([always.pause.active, always.pause.until]).toEqual([true, null]);
    });

    it("refuses to allow a rule that is not blocking, unless given a time", async () => {
      const auth = await signedIn();
      const emma = await child();
      const later = await ruleOf(
        await postRule(auth, {
          name: "Later",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
        }),
      );
      expect(await errorCode(await ruleAction(allowRule, auth, later.id))).toEqual([409, "not_in_window"]);
      const explicit = await ruleAction(allowRule, auth, later.id, { until: inMinutes(30).toISOString() });
      expect(explicit.status).toBe(200);
    });

    it("answers 409 for a rule that is off, or a pause that is not there to extend", async () => {
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      expect(await errorCode(await ruleAction(extendRule, auth, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);

      await ruleAction(pauseRule, auth, video.id);
      const off = await ruleOf(await ruleAction(turnOffRule, auth, video.id, null));
      // Off and paused never overlap: turning a rule off ends its pause.
      expect([off.enabled, off.pause.active]).toEqual([false, false]);
      for (const handler of [pauseRule, allowRule]) {
        expect(await errorCode(await ruleAction(handler, auth, video.id))).toEqual([409, "rule_off"]);
      }
      expect(await errorCode(await ruleAction(extendRule, auth, video.id, { minutes: 15 }))).toEqual([409, "rule_off"]);
      // Resume always succeeds.
      expect((await ruleAction(resumeRule, auth, video.id, null)).status).toBe(200);

      const on = await ruleOf(await ruleAction(turnOnRule, auth, video.id, null));
      expect(on.enabled).toBe(true);
    });

    it("rejects a pause that ends in the past, and unknown rules", async () => {
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      expect(await errorCode(await ruleAction(pauseRule, auth, video.id, { until: inMinutes(-5).toISOString() }))).toEqual([400, "invalid_request"]);
      expect((await ruleAction(pauseRule, auth, "missing")).status).toBe(404);
    });

    it("cannot be set by editing a rule, and turning a rule off through an edit ends the pause", async () => {
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      const rejected = await patch(auth, video.id, { pause: { active: true, until: null, by: null } });
      expect(rejected.status).toBe(400);
      await ruleAction(pauseRule, auth, video.id);
      const edited = await ruleOf(await patch(auth, video.id, { name: "TV Video 2" }));
      expect(edited.pause.active).toBe(true);
      const off = await ruleOf(await patch(auth, video.id, { enabled: false }));
      expect(off.pause.active).toBe(false);
    });

    it("clears an expired pause on the next tick", async () => {
      const auth = await signedIn();
      const { video } = await videoAndBedtime(auth);
      await ruleAction(pauseRule, auth, video.id, { until: inMinutes(30).toISOString() });
      await prisma().rule.update({ where: { id: video.id }, data: { pauseUntil: inMinutes(-1) } });
      await runReconcileOnce();
      const stored = await prisma().rule.findUniqueOrThrow({ where: { id: video.id } });
      expect([stored.pauseActive, stored.pauseUntil, stored.pausedByName]).toEqual([false, null, null]);
      expect(policiesNamed(client, "FamilyFi TV Video")[0]?.enabled).toBe(true);
    });

    it("makes a paused internet rule not blocking, so allowing the group is refused", async () => {
      const auth = await signedIn();
      const { emma, bedtime } = await videoAndBedtime(auth);
      expect((await readGroup(auth, emma.id)).access).toBe("blocked");
      await ruleAction(pauseRule, auth, bedtime.id);
      const group = await readGroup(auth, emma.id);
      expect([group.access, group.internetRuleIds]).toEqual(["available", [bedtime.id]]);
      expect((await groupAction(allow, auth, emma.id)).status).toBe(409);
      // A group's own pause still blocks while its rule is paused.
      await groupAction(pause, auth, emma.id);
      expect((await readGroup(auth, emma.id)).access).toBe("paused");
    });
  });

  describe("pause and allowance are told apart, and either can apply to one group", () => {
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    /** Two children in one Video rule, one device each, reconciled onto the gateway. */
    async function twoChildren(auth: SessionAuth) {
      const emma = await child();
      const ava = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
      await seedDevice({ mac: "02:00:00:00:00:02", groupId: ava.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
      const video = await ruleOf(await postRule(auth, { name: "TV Video", kind: "category", groupIds: [emma.id, ava.id], targetIds: [4], mode: "always" }));
      await runReconcileOnce();
      return { emma, ava, video };
    }

    it("ends only the kind it names: resume a pause, disallow an allowance", async () => {
      const auth = await signedIn();
      const { video } = await twoChildren(auth);

      const allowed = await ruleOf(await ruleAction(allowRule, auth, video.id));
      expect([allowed.pause.active, allowed.pause.kind]).toEqual([true, "allow"]);
      expect((await ruleOf(await ruleAction(resumeRule, auth, video.id, null))).pause.active).toBe(true);
      expect(await errorCode(await ruleAction(extendRule, auth, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);
      expect((await ruleOf(await ruleAction(disallowRule, auth, video.id, null))).pause).toMatchObject({ active: false, until: null, kind: "pause" });

      const paused = await ruleOf(await ruleAction(pauseRule, auth, video.id));
      expect([paused.pause.active, paused.pause.kind]).toEqual([true, "pause"]);
      expect((await ruleOf(await ruleAction(disallowRule, auth, video.id, null))).pause.active).toBe(true);
      expect((await ruleOf(await ruleAction(resumeRule, auth, video.id, null))).pause.active).toBe(false);
      // Ending what is not there still succeeds.
      expect((await ruleAction(disallowRule, auth, video.id, null)).status).toBe(200);
    });

    it("lifts a rule for one group: its devices leave the policy and the others stay", async () => {
      const auth = await signedIn();
      const { emma, video } = await twoChildren(auth);
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);

      const until = inMinutes(30);
      const paused = await ruleOf(await groupRuleAction(pauseGroupRule, auth, emma.id, video.id, { until: until.toISOString() }));
      expect(paused.pause.active).toBe(false);
      expect(paused.groupPauses).toEqual([{ groupId: emma.id, pause: expect.objectContaining({ active: true, kind: "pause", until: until.toISOString() }) }]);
      await runReconcileOnce();
      // Ava's policy still blocks; Emma is alone in hers, so it keeps her device but is disabled.
      const live = policiesNamed(client, "FamilyFi TV Video").filter((item) => item.enabled);
      expect(live.flatMap((item) => policyMacs(item))).toEqual(["02:00:00:00:00:02"]);
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);

      const extended = await ruleOf(await groupRuleAction(extendGroupRule, auth, emma.id, video.id, { minutes: 15 }));
      expect(new Date(extended.groupPauses[0]!.pause.until!).getTime()).toBe(until.getTime() + 15 * 60_000);

      const resumed = await ruleOf(await groupRuleAction(resumeGroupRule, auth, emma.id, video.id, null));
      expect(resumed.groupPauses).toEqual([]);
      await runReconcileOnce();
      expect(macsNamed(client, "FamilyFi TV Video")).toEqual([MAC, "02:00:00:00:00:02"]);
    });

    it("disables a policy that has no one left, keeping its devices, and re-enables it on disallow", async () => {
      const auth = await signedIn();
      const emma = await child();
      const video = await ruleOf(await postRule(auth, { name: "TV Video", kind: "category", groupIds: [emma.id], targetIds: [4], mode: "always" }));
      await runReconcileOnce();
      const [policy] = policiesNamed(client, "FamilyFi TV Video");

      const allowed = await ruleOf(await groupRuleAction(allowGroupRule, auth, emma.id, video.id));
      expect(allowed.groupPauses[0]?.pause).toMatchObject({ active: true, kind: "allow", until: null });
      await runReconcileOnce();
      const off = client.state.policies.find((item) => item.id === policy!.id);
      expect([off?.enabled, policyMacs(off!)]).toEqual([false, [MAC]]);

      await groupRuleAction(disallowGroupRule, auth, emma.id, video.id, null);
      await runReconcileOnce();
      expect(client.state.policies.find((item) => item.id === policy!.id)?.enabled).toBe(true);
      expect(policiesNamed(client, "FamilyFi TV Video")).toHaveLength(1);
    });

    it("lets a group's internet rule stop counting as blocking for that group alone", async () => {
      const auth = await signedIn();
      const emma = await child();
      const ava = await prisma().group.create({ data: { kind: GroupKind.family, name: "Ava", familyRole: FamilyRole.child } });
      const homework = await ruleOf(
        await postRule(auth, {
          name: "Homework",
          kind: "internet",
          groupIds: [emma.id, ava.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(-60), end: utcClock(60) }],
        }),
      );
      expect([(await readGroup(auth, emma.id)).access, (await readGroup(auth, ava.id)).access]).toEqual(["blocked", "blocked"]);
      const allowed = await ruleOf(await groupRuleAction(allowGroupRule, auth, emma.id, homework.id));
      expect(Math.abs(new Date(allowed.groupPauses[0]!.pause.until!).getTime() - inMinutes(60).getTime())).toBeLessThan(2 * 60_000);
      expect([(await readGroup(auth, emma.id)).access, (await readGroup(auth, ava.id)).access]).toEqual(["available", "blocked"]);
    });

    it("answers 404 for a group that does not have the rule, 409 for a rule that is off, and 409 without a window", async () => {
      const auth = await signedIn();
      const { emma, video } = await twoChildren(auth);
      const stranger = await prisma().group.create({ data: { kind: GroupKind.family, name: "Stranger", familyRole: FamilyRole.child } });
      expect(await errorCode(await groupRuleAction(pauseGroupRule, auth, stranger.id, video.id))).toEqual([404, "not_found"]);
      expect(await errorCode(await groupRuleAction(pauseGroupRule, auth, emma.id, "missing"))).toEqual([404, "not_found"]);
      expect(await errorCode(await groupRuleAction(extendGroupRule, auth, emma.id, video.id, { minutes: 15 }))).toEqual([409, "not_paused"]);

      await ruleAction(turnOffRule, auth, video.id, null);
      expect(await errorCode(await groupRuleAction(pauseGroupRule, auth, emma.id, video.id))).toEqual([409, "rule_off"]);
      await ruleAction(turnOnRule, auth, video.id, null);

      const later = await ruleOf(
        await postRule(auth, {
          name: "Later",
          kind: "internet",
          groupIds: [emma.id],
          mode: "scheduled",
          windows: [{ days: EVERY_DAY, start: utcClock(120), end: utcClock(180) }],
        }),
      );
      expect(await errorCode(await groupRuleAction(allowGroupRule, auth, emma.id, later.id))).toEqual([409, "not_in_window"]);
    });

    it("clears an expired group lift on the next tick, and keeps a lift through an edit", async () => {
      const auth = await signedIn();
      const { emma, video } = await twoChildren(auth);
      await groupRuleAction(pauseGroupRule, auth, emma.id, video.id, { until: inMinutes(30).toISOString() });
      const edited = await ruleOf(await patch(auth, video.id, { name: "TV Video 2" }));
      expect(edited.groupPauses).toHaveLength(1);
      await prisma().ruleGroup.update({ where: { ruleId_groupId: { ruleId: video.id, groupId: emma.id } }, data: { pauseUntil: inMinutes(-1) } });
      await runReconcileOnce();
      const link = await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: video.id, groupId: emma.id } } });
      expect([link.pauseActive, link.pauseUntil, link.pausedByName]).toEqual([false, null, null]);
    });
  });
});
