/**
 * A group's Block button default: one of its own category, app or website rules that the card's
 * Block button unblocks and puts back instead of all internet. It is set on the group, and the
 * group's unblock lifts it even when it is always on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignmentState, GroupKind } from "@prisma/client";
import { prisma } from "@/server/db";
import { unblockGroup } from "@/server/group-unblock";
import { getGroup, updateGroup } from "@/server/groups";
import { deleteRule, updateRule } from "@/server/rule-lifts";
import { createRule, RuleCreateBody } from "@/server/rules";
import { setReconcileClientForTests } from "@/server/reconciliation";
import { INTERNAL_ZONE, configureConnectedHousehold, resetDatabase, seedDevice } from "../helpers/db";
import { refusal } from "../helpers/refusal";
import { adminSession } from "../helpers/session";
import { fixtureUnifiClient } from "../helpers/unifi-world";

const MAC = "02:00:00:00:00:01";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

async function rule(body: object): Promise<string> {
  return (await createRule(RuleCreateBody.parse(body))).rule.id;
}

const edit = (id: string, body: Parameters<typeof updateGroup>[1]) => updateGroup(id, body);

describe("a group's Block button default", () => {
  let client: ReturnType<typeof fixtureUnifiClient>;
  let session: Awaited<ReturnType<typeof adminSession>>;
  let tv: { id: string };
  let video: string;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC" } });
    client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    session = await adminSession();
    tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV", monogram: "TV" } });
    await seedDevice({ mac: MAC, groupId: tv.id, zoneId: INTERNAL_ZONE, assignment: AssignmentState.assigned });
    // Video outside its window all day: the hour before now never comes round until tomorrow.
    const hour = (new Date().getUTCHours() + 22) % 24;
    const clock = (h: number) => `${String(h).padStart(2, "0")}:00`;
    video = await rule({
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
    expect((await getGroup(tv.id)).blockButtonRuleId).toBeUndefined();
    const downtime = await rule({ name: "Downtime", kind: "internet", groupIds: [tv.id], mode: "always" });
    const other = await prisma().group.create({ data: { kind: GroupKind.things, name: "PC" } });
    const elsewhere = await rule({ name: "PC video", kind: "category", groupIds: [other.id], targetIds: [4], mode: "always" });
    for (const id of [downtime, elsewhere, "countries", "missing"]) {
      expect(await refusal(edit(tv.id, { blockButtonRuleId: id })), id).toEqual([400, "invalid_block_button_rule"]);
    }

    expect((await edit(tv.id, { blockButtonRuleId: video })).group.blockButtonRuleId).toBe(video);
    // An edit that leaves it out keeps it.
    await edit(tv.id, { name: "Living room TV" });
    expect((await getGroup(tv.id)).blockButtonRuleId).toBe(video);
    await edit(tv.id, { blockButtonRuleId: null });
    expect((await getGroup(tv.id)).blockButtonRuleId).toBeUndefined();
  });

  it("goes back to all internet when its rule is deleted", async () => {
    await edit(tv.id, { blockButtonRuleId: video });
    await deleteRule(video);
    expect((await getGroup(tv.id)).blockButtonRuleId).toBeUndefined();
    expect((await prisma().group.findUniqueOrThrow({ where: { id: tv.id } })).blockButtonRuleId).toBeNull();
  });

  it("goes back to all internet when the rule stops covering the group, so it doesn't come back with it", async () => {
    await edit(tv.id, { blockButtonRuleId: video });
    const pc = await prisma().group.create({ data: { kind: GroupKind.things, name: "PC" } });
    const groups = (groupIds: string[]) => updateRule(session, video, { groupIds });
    await groups([pc.id]);
    await groups([pc.id, tv.id]);
    expect((await getGroup(tv.id)).blockButtonRuleId).toBeUndefined();
  });

  it("is lifted by the group's unblock even when always on, while other always-on rules stay on", async () => {
    const always = await rule({ name: "Video", kind: "category", groupIds: [tv.id], targetIds: [4], mode: "always" });
    const social = await rule({ name: "Social", kind: "category", groupIds: [tv.id], targetIds: [24], mode: "always" });
    await edit(tv.id, { blockButtonRuleId: always });
    await unblockGroup(session, "unblock", tv.id, {});
    const links = await prisma().ruleGroup.findMany({ where: { groupId: tv.id, ruleId: { in: [always, social] } } });
    const lifted = Object.fromEntries(links.map((link) => [link.ruleId === always ? "video" : "social", link.pauseActive]));
    // Social is how the TV is set up and stays on; Video is what its button is for.
    expect(lifted).toEqual({ video: true, social: false });
  });
});
