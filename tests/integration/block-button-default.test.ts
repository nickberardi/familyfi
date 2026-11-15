/**
 * A group's Block button default: one of its own category, app or website rules that the card's
 * Block button blocks and unblocks instead of all internet. It is set on the group, blocks that
 * rule now through the group's own block whatever the rule's schedule says, and a pause of all
 * internet and that block replace each other.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroup, PUT as putGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as createRule } from "@/app/api/v1/rules/route";
import { DELETE as deleteRule, PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import { POST as pauseGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as resumeGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { POST as blockRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/block/route";
import { POST as endRuleBlock } from "@/app/api/v1/groups/[id]/rules/[ruleId]/block/end/route";
import { POST as extendRuleBlock } from "@/app/api/v1/groups/[id]/rules/[ruleId]/block/extend/route";
import { POST as unblockGroup } from "@/app/api/v1/groups/[id]/unblock/route";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { INTERNAL_ZONE, configureConnectedHousehold, resetDatabase, seedDevice } from "../helpers/db";
import { fixtureUnifiClient, policyMacs } from "../helpers/unifi-world";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const MAC = "02:00:00:00:00:01";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

type Actor = { name: string } | null;
type PublicGroup = {
  access: string;
  suspension: { active: boolean; until: string | null; by: Actor };
  blockButtonRuleId?: string;
  ruleBlock?: { ruleId: string; until: string | null; by: Actor };
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

async function rule(auth: SessionAuth, body: object): Promise<string> {
  const response = await createRule(request("/api/v1/rules", { method: "POST", auth, headers: json, body: JSON.stringify(body) }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { rule: { id: string } }).rule.id;
}

async function edit(auth: SessionAuth, id: string, body: object) {
  return putGroup(request(`/api/v1/groups/${id}`, { method: "PUT", auth, headers: json, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

async function read(auth: SessionAuth, id: string): Promise<PublicGroup> {
  const response = await getGroup(request(`/api/v1/groups/${id}`, { auth }), { params: Promise.resolve({ id }) });
  return ((await response.json()) as { group: PublicGroup }).group;
}

async function verb(handler: typeof blockRule, auth: SessionAuth, id: string, ruleId: string, body: object | null = {}) {
  return handler(
    request(`/api/v1/groups/${id}/rules/${ruleId}/x`, { method: "POST", auth, headers: json, body: body === null ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({ id, ruleId }) },
  );
}

async function errorCode(response: Response): Promise<[number, string]> {
  return [response.status, ((await response.json()) as { error: { code: string } }).error.code];
}

describe("a group's Block button default", () => {
  let client: ReturnType<typeof fixtureUnifiClient>;
  let auth: SessionAuth;
  let tv: { id: string };
  let video: string;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC" } });
    client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    auth = await signedIn();
    tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
    await seedDevice({ mac: MAC, groupId: tv.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
    // Video outside its window all day: the hour before now never comes round until tomorrow.
    const hour = (new Date().getUTCHours() + 22) % 24;
    const clock = (h: number) => `${String(h).padStart(2, "0")}:00`;
    video = await rule(auth, {
      name: "TV video",
      kind: "category",
      groupIds: [tv.id],
      targetIds: [4],
      mode: "scheduled",
      windows: [{ name: "Evenings", days: EVERY_DAY, start: clock(hour), end: clock((hour + 1) % 24) }],
    });
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("is all internet until set, takes only the group's own category, app or website rules, and can be cleared", async () => {
    expect((await read(auth, tv.id)).blockButtonRuleId).toBeUndefined();
    const downtime = await rule(auth, { name: "Downtime", kind: "internet", groupIds: [tv.id], mode: "always" });
    const other = await prisma().group.create({ data: { kind: GroupKind.things, name: "PC" } });
    const elsewhere = await rule(auth, { name: "PC video", kind: "category", groupIds: [other.id], targetIds: [4], mode: "always" });
    for (const id of [downtime, elsewhere, "countries", "missing"]) {
      expect(await errorCode(await edit(auth, tv.id, { blockButtonRuleId: id })), id).toEqual([400, "invalid_block_button_rule"]);
    }

    const set = await edit(auth, tv.id, { blockButtonRuleId: video });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { group: PublicGroup }).group.blockButtonRuleId).toBe(video);
    // An edit that leaves it out keeps it.
    await edit(auth, tv.id, { name: "Living room TV" });
    expect((await read(auth, tv.id)).blockButtonRuleId).toBe(video);
    await edit(auth, tv.id, { blockButtonRuleId: null });
    expect((await read(auth, tv.id)).blockButtonRuleId).toBeUndefined();
  });

  it("goes back to all internet when its rule is deleted", async () => {
    await edit(auth, tv.id, { blockButtonRuleId: video });
    await deleteRule(request(`/api/v1/rules/${video}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: video }) });
    expect((await read(auth, tv.id)).blockButtonRuleId).toBeUndefined();
    expect((await prisma().group.findUniqueOrThrow({ where: { id: tv.id } })).blockButtonRuleId).toBeNull();
  });

  it("goes back to all internet, and its block ends, when the rule stops covering the group, so neither comes back with it", async () => {
    await edit(auth, tv.id, { blockButtonRuleId: video });
    expect((await verb(blockRule, auth, tv.id, video)).status).toBe(200);
    const pc = await prisma().group.create({ data: { kind: GroupKind.things, name: "PC" } });
    const groups = async (groupIds: string[]) => {
      const response = await patchRule(
        request(`/api/v1/rules/${video}`, { method: "PATCH", auth, headers: json, body: JSON.stringify({ groupIds }) }),
        { params: Promise.resolve({ id: video }) },
      );
      expect(response.status).toBe(200);
    };
    await groups([pc.id]);
    await groups([pc.id, tv.id]);
    const group = await read(auth, tv.id);
    expect([group.blockButtonRuleId, group.ruleBlock]).toEqual([undefined, undefined]);
    expect((await prisma().rule.findUniqueOrThrow({ where: { systemGroupId: tv.id } })).enabled).toBe(false);
  });

  it("ends a block of its rule when it changes, so the old block is never left with no button to end it", async () => {
    const social = await rule(auth, { name: "TV social", kind: "category", groupIds: [tv.id], targetIds: [24], mode: "always" });
    await edit(auth, tv.id, { blockButtonRuleId: video });
    expect((await verb(blockRule, auth, tv.id, video)).status).toBe(200);
    // Saving the same choice keeps the block.
    await edit(auth, tv.id, { name: "TV", blockButtonRuleId: video });
    expect((await read(auth, tv.id)).ruleBlock?.ruleId).toBe(video);

    await edit(auth, tv.id, { blockButtonRuleId: social });
    expect((await read(auth, tv.id)).ruleBlock).toBeUndefined();
    expect((await verb(blockRule, auth, tv.id, social)).status).toBe(200);
    await edit(auth, tv.id, { blockButtonRuleId: null });
    const group = await read(auth, tv.id);
    expect([group.blockButtonRuleId, group.ruleBlock]).toEqual([undefined, undefined]);
  });

  it("blocks the rule's category now with the group's own block, until ended, leaving the internet on", async () => {
    await edit(auth, tv.id, { blockButtonRuleId: video });
    await runReconcileOnce();
    const mine = () => client.state.policies.filter((policy) => policyMacs(policy).includes(MAC));
    // Outside its window, Video has its scheduled policy and nothing else.
    expect(mine().map((policy) => policy.name)).toEqual(["FamilyFi TV video"]);

    const blocked = await verb(blockRule, auth, tv.id, video);
    expect(blocked.status).toBe(200);
    const group = ((await blocked.json()) as { group: PublicGroup }).group;
    expect(group.ruleBlock).toEqual({ ruleId: video, until: null, by: { accountId: expect.any(String), name: "Recovery admin" } });
    // The group keeps its internet: this is not a pause.
    expect([group.access, group.suspension.active]).toEqual(["available", false]);

    await runReconcileOnce();
    const block = mine().find((policy) => policy.name === "FamilyFi TV video Block");
    expect([block?.enabled, block?.destination.trafficFilter?.type]).toEqual([true, "APPLICATION_CATEGORY"]);

    await verb(endRuleBlock, auth, tv.id, video, null);
    await runReconcileOnce();
    expect((await read(auth, tv.id)).ruleBlock).toBeUndefined();
    expect(mine().map((policy) => policy.name)).toEqual(["FamilyFi TV video"]);
  });

  it("extends a timed block, and a pause of all internet and the block replace each other", async () => {
    await edit(auth, tv.id, { blockButtonRuleId: video });
    expect(await errorCode(await verb(extendRuleBlock, auth, tv.id, video, { minutes: 15 }))).toEqual([409, "not_blocked"]);
    const until = new Date(Date.now() + 30 * 60_000);
    await verb(blockRule, auth, tv.id, video, { until: until.toISOString() });
    const extended = ((await (await verb(extendRuleBlock, auth, tv.id, video, { minutes: 15 })).json()) as { group: PublicGroup }).group;
    expect(Date.parse(extended.ruleBlock!.until!)).toBe(until.getTime() + 15 * 60_000);
    expect(await errorCode(await verb(blockRule, auth, tv.id, video, { until: new Date(Date.now() - 60_000).toISOString() }))).toEqual([400, "invalid_request"]);

    // Resuming all internet does not end the block of Video: that is not a pause.
    await verb(resumeGroupRule, auth, tv.id, "internet", null);
    expect((await read(auth, tv.id)).ruleBlock?.ruleId).toBe(video);

    const paused = ((await (await verb(pauseGroupRule, auth, tv.id, "internet")).json()) as { group: PublicGroup }).group;
    expect([paused.access, paused.suspension.active, paused.ruleBlock]).toEqual(["paused", true, undefined]);
    await runReconcileOnce();
    const pause = client.state.policies.find((policy) => policy.name === "FamilyFi TV Internet Pause");
    expect(pause?.destination.trafficFilter?.type).not.toBe("APPLICATION_CATEGORY");

    const again = ((await (await verb(blockRule, auth, tv.id, video)).json()) as { group: PublicGroup }).group;
    expect([again.suspension.active, again.ruleBlock?.ruleId]).toEqual([false, video]);
  });

  it("is ended by the group's unblock, which also lifts an always-on Block button rule", async () => {
    const always = await rule(auth, { name: "Video", kind: "category", groupIds: [tv.id], targetIds: [4], mode: "always" });
    const social = await rule(auth, { name: "Social", kind: "category", groupIds: [tv.id], targetIds: [24], mode: "always" });
    await edit(auth, tv.id, { blockButtonRuleId: always });
    expect((await verb(blockRule, auth, tv.id, always)).status).toBe(200);
    const response = await unblockGroup(request(`/api/v1/groups/${tv.id}/unblock`, { method: "POST", auth, headers: json }), { params: Promise.resolve({ id: tv.id }) });
    expect(response.status).toBe(200);
    expect((await read(auth, tv.id)).ruleBlock).toBeUndefined();
    const links = await prisma().ruleGroup.findMany({ where: { groupId: tv.id, ruleId: { in: [always, social] } } });
    const lifted = Object.fromEntries(links.map((link) => [link.ruleId === always ? "video" : "social", link.pauseActive]));
    // Social is how the TV is set up and stays on; Video is what its button is for.
    expect(lifted).toEqual({ video: true, social: false });
  });

  it("answers 404 for a rule the group does not have, or an internet rule, and 409 for a rule that is not its default", async () => {
    // Only the Block button can end a block, so a block of any other rule would have nothing to end it.
    expect(await errorCode(await verb(blockRule, auth, tv.id, video))).toEqual([409, "not_block_button_default"]);
    const downtime = await rule(auth, { name: "Downtime", kind: "internet", groupIds: [tv.id], mode: "always" });
    expect(await errorCode(await verb(blockRule, auth, tv.id, downtime))).toEqual([404, "not_found"]);
    expect(await errorCode(await verb(blockRule, auth, tv.id, "missing"))).toEqual([404, "not_found"]);
  });
});
