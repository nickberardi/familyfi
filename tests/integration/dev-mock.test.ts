import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountKind, AssignmentState, RuleLiftKind } from "@prisma/client";
import { DEV_DEVICES, DEV_DOH_URL } from "@/server/dev-household";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { prisma } from "@/server/db";
import { ensureDevDummyData, DEV_SEED_ADULT_USERNAME } from "@/server/dev-seed";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { resetDatabase } from "../helpers/db";

describe("dev UniFi mock household", () => {
  const previous = process.env.UNIFI_MOCK;

  beforeEach(async () => {
    process.env.UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    setReconcileClientForTests(undefined);
    await resetDatabase();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.UNIFI_MOCK;
    else process.env.UNIFI_MOCK = previous;
    setReconcileClientForTests(undefined);
    resetDevMockClientForTests();
  });

  it("saves a dummy key without a live console and discovers the household's online devices", async () => {
    await saveUnifiConnection({
      apiKey: DEV_MOCK_API_KEY,
      baseUrl: DEV_MOCK_BASE_URL,
    });
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.unifiManageAllNetworks).toBe(true);
    expect(household.unifiKeyLastFour).toBe(DEV_MOCK_API_KEY.slice(-4));
    expect(await runReconcileOnce()).toBe(true);
    const devices = await prisma().device.findMany({ orderBy: { mac: "asc" } });
    expect(devices.map((row) => row.mac)).toEqual(DEV_DEVICES.filter((item) => item.online).map((item) => item.mac));
    // Every device is on a managed network, so discovery holds each one for assignment.
    expect(devices.every((row) => row.assignment === AssignmentState.quarantined && row.presenceOnline)).toBe(true);
  });

  it("seeds the household, its rules and live states, and an administrator login", async () => {
    await ensureUpstreamCategories();
    await ensureDevDummyData();
    const groups = await prisma().group.findMany({ orderBy: { createdAt: "asc" } });
    expect(groups.map((group) => [group.name, group.kind, group.familyRole ?? group.monogram])).toEqual([
      ["Nick", "family", "adult"],
      ["Melinda", "family", "adult"],
      ["Betsy", "family", "teen"],
      ["Abby", "family", "teen"],
      ["Cassie", "family", "child"],
      ["TV", "things", "TV"],
      ["Computers", "things", "PC"],
      ["Games", "things", "GAME"],
      ["Servers", "things", "SRV"],
    ]);
    const idOf = (name: string) => groups.find((group) => group.name === name)!.id;
    const byName = new Map(groups.map((group) => [group.id, group.name]));

    const rules = await prisma().rule.findMany({ where: { systemGroupId: null }, include: { groups: true, windows: true }, orderBy: { name: "asc" } });
    expect(rules.map((rule) => [rule.name, rule.kind, rule.groups.map((link) => byName.get(link.groupId)).sort(), rule.windows.length])).toEqual([
      ["Adult content", "category", ["Computers"], 0],
      ["Bedtime", "internet", ["Cassie"], 1],
      ["Focus hours", "category", ["Computers"], 1],
      ["Gaming hours", "internet", ["Games"], 2],
      ["Homework", "internet", ["Cassie"], 1],
      ["Kid apps", "app", ["Cassie"], 0],
      ["Late gaming", "category", ["Abby"], 1],
      ["No TikTok", "domain", ["Abby", "Betsy"], 0],
      ["School nights", "internet", ["Abby", "Betsy"], 1],
      ["TV downtime", "internet", ["TV"], 2],
      ["TV video evenings", "category", ["TV"], 2],
    ]);
    // The browser specs edit Betsy and Abby and delete Betsy's category rules: she has none.
    expect(rules.filter((rule) => rule.kind === "category" && rule.groups.some((link) => link.groupId === idOf("Betsy")))).toEqual([]);
    // Adults have no rules, so the Rules page has a group to name as unfiltered.
    expect(rules.filter((rule) => rule.groups.some((link) => [idOf("Nick"), idOf("Melinda")].includes(link.groupId)))).toEqual([]);

    const nick = await prisma().account.findUniqueOrThrow({ where: { username: DEV_SEED_ADULT_USERNAME } });
    expect([nick.isAdmin, nick.groupId]).toEqual([true, idOf("Nick")]);
    // Melinda is an adult with no login: only administrators sign in.
    expect((await prisma().account.findMany({ where: { kind: AccountKind.personal } })).map((account) => account.username)).toEqual(["nick"]);

    // Live states: Cassie paused, an allowance on Games, and Focus hours paused for everyone.
    const block = await prisma().rule.findFirstOrThrow({ where: { systemGroupId: idOf("Cassie") } });
    expect([block.enabled, block.blockedByName, block.expiresAt! > new Date()]).toEqual([true, "Nick", true]);
    const allowed = rules.find((rule) => rule.name === "Gaming hours")!.groups[0]!;
    expect([allowed.pauseActive, allowed.pauseKind, allowed.pausedByName]).toEqual([true, RuleLiftKind.allow, "Nick"]);
    const paused = rules.find((rule) => rule.name === "Focus hours")!;
    expect([paused.pauseActive, paused.pauseKind, paused.enabled]).toEqual([true, RuleLiftKind.pause, true]);

    // Categories report through Cloudflare for Families, measured for every category but
    // Video, at the household and for each group; the probe never replaces them.
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect([household.dohUrl, household.dohProbeEnabled]).toEqual([DEV_DOH_URL, false]);
    const checks = await prisma().upstreamCheck.findMany({ where: { groupId: null }, include: { category: true } });
    expect(Object.fromEntries(checks.map((check) => [check.category.slug, check.verdict]))).toEqual({
      adult: "blocked",
      ai: "open",
      dating: "partial",
      gambling: "open",
      gaming: "open",
      messaging: "open",
      social: "open",
      vpn: "open",
    });
    expect(await prisma().upstreamCheck.count({ where: { groupId: idOf("Betsy") } })).toBe(8);

    expect(await runReconcileOnce()).toBe(true);
    const devices = await prisma().device.findMany({ include: { group: true }, orderBy: { mac: "asc" } });
    expect(devices.map((row) => [row.hostname, row.group?.name ?? null, row.presenceOnline])).toEqual(
      DEV_DEVICES.map((item) => [item.name, item.group, item.online]),
    );
    // Every group has a device, and some are left unassigned for the Devices banner.
    expect(groups.every((group) => devices.some((row) => row.groupId === group.id))).toBe(true);
    expect(devices.filter((row) => row.assignment === AssignmentState.quarantined).map((row) => row.hostname)).toEqual([
      "Guest Laptop",
      "Galaxy S24",
      "Echo Dot",
    ]);

    await ensureDevDummyData();
    expect(await prisma().group.count()).toBe(9);
    expect(await prisma().rule.count()).toBe(12);
    expect(await prisma().account.count({ where: { username: DEV_SEED_ADULT_USERNAME } })).toBe(1);
  });
});
