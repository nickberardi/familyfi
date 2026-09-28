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
    const protectedGroup = await prisma().group.create({ data: { kind: GroupKind.family, name: "Pat", familyRole: FamilyRole.adult, protected: true } });
    const window = { days: EVERY_DAY, start: "21:00", end: "07:00" };
    const cases: [object, number, string][] = [
      [{ name: "All day", kind: "internet", groupIds: [emma.id], mode: "always" }, 400, "invalid_schedule"],
      [{ name: "No windows", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows: [] }, 400, "invalid_schedule"],
      [{ name: " ", kind: "internet", groupIds: [emma.id], mode: "scheduled", windows: [window] }, 400, "invalid_name"],
      [{ name: "Nobody", kind: "internet", groupIds: [], mode: "scheduled", windows: [window] }, 400, "invalid_groups"],
      [{ name: "Adults", kind: "internet", groupIds: [protectedGroup.id], mode: "scheduled", windows: [window] }, 409, "protected"],
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

  it("lets a pause replace an allowance", async () => {
    const auth = await signedIn();
    const emma = await child();
    await groupAction(allow, auth, emma.id, "POST", JSON.stringify({ until: null }));
    const paused = await groupAction(pause, auth, emma.id);
    const group = ((await paused.json()) as { group: PublicGroup }).group;
    expect(group.allowance).toEqual({ active: false, until: null, by: null });
    expect(group.access).toBe("paused");
  });
});
