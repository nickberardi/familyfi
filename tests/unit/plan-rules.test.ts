import { AssignmentState, GroupKind, RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { planRulePolicies, plannedRuleKey, rulePolicyWrite, type PlanRule } from "@/server/unifi/plan-rules";

const device = (mac: string, groupId: string, zoneId = "zone-1") => ({
  mac,
  assignment: AssignmentState.assigned,
  groupId,
  zoneId,
  inScope: true,
});

const group = (id: string, patch: Partial<{ protected: boolean; allowed: boolean }> = {}) => ({
  id,
  kind: GroupKind.family,
  protected: false,
  allowed: false,
  ...patch,
});

const rule = (patch: Partial<PlanRule>): PlanRule => ({
  id: "r1",
  name: "Rule",
  useGeneratedName: false,
  kind: RuleKind.category,
  scope: RuleScope.group,
  groupIds: ["g1"],
  networkIds: [],
  targetIds: [4],
  domains: [],
  enabled: true,
  mode: RuleMode.always,
  windows: [],
  ...patch,
});

const plan = (rules: PlanRule[], groups = [group("g1")], devices = [device("02:00:00:00:00:01", "g1")]) =>
  planRulePolicies({
    destinationZoneId: "ext",
    zoneNames: { "zone-1": "Internal", "zone-2": "IoT" },
    groups,
    devices,
    rules,
  });

const tvDowntime = rule({
  id: "tv",
  name: "TV downtime",
  kind: RuleKind.internet,
  mode: RuleMode.scheduled,
  targetIds: [],
  windows: [
    { id: "w-dinner", position: 0, name: "Dinner", days: [0, 1, 2, 3, 4, 5, 6], start: "18:00", end: "20:00" },
    { id: "w-night", position: 1, name: "Overnight", days: [0, 1, 2, 3, 4, 5, 6], start: "23:00", end: "07:00" },
  ],
});

describe("planRulePolicies", () => {
  it("plans one policy per window, named after the rule and window", () => {
    const { policies } = plan([tvDowntime]);
    expect(policies.map((policy) => [policy.key, policy.name, policy.schedule?.timeFilter])).toEqual([
      [plannedRuleKey("tv", "w-dinner", "zone-1"), "FamilyFi TV downtime – Dinner", { startTime: "18:00", stopTime: "20:00" }],
      [plannedRuleKey("tv", "w-night", "zone-1"), "FamilyFi TV downtime – Overnight", { startTime: "23:00", stopTime: "07:00" }],
    ]);
  });

  it("names the only window's policy after the rule, and an always rule's one policy", () => {
    const single = { ...tvDowntime, windows: tvDowntime.windows.slice(0, 1) };
    expect(plan([single]).policies.map((policy) => policy.name)).toEqual(["FamilyFi TV downtime"]);
    const always = rule({ name: "No social", mode: RuleMode.always });
    const { policies } = plan([always]);
    expect(policies.map((policy) => [policy.windowKey, policy.name, policy.schedule])).toEqual([["always", "FamilyFi No social", undefined]]);
  });

  it("puts every covered group's devices in the same policy, per zone, and skips protected groups", () => {
    const { policies } = plan(
      [rule({ groupIds: ["g1", "g2", "g3"] })],
      [group("g1"), group("g2"), group("g3", { protected: true })],
      [
        device("02:00:00:00:00:01", "g1"),
        device("02:00:00:00:00:02", "g2"),
        device("02:00:00:00:00:03", "g2", "zone-2"),
        device("02:00:00:00:00:04", "g3"),
      ],
    );
    expect(policies.map((policy) => [policy.zoneId, policy.macAddresses, policy.name])).toEqual([
      ["zone-1", ["02:00:00:00:00:01", "02:00:00:00:00:02"], "FamilyFi Rule"],
      ["zone-2", ["02:00:00:00:00:03"], "FamilyFi Rule (IoT)"],
    ]);
  });

  it("leaves a group with an allowance out of its internet rules only", () => {
    const groups = [group("g1", { allowed: true }), group("g2")];
    const devices = [device("02:00:00:00:00:01", "g1"), device("02:00:00:00:00:02", "g2")];
    const internet = { ...tvDowntime, groupIds: ["g1", "g2"] };
    const video = rule({ id: "video", groupIds: ["g1", "g2"] });
    const { policies } = plan([internet, video], groups, devices);
    const macs = (id: string) => policies.filter((policy) => policy.ruleId === id).map((policy) => [policy.macAddresses, policy.enabled]);
    expect(macs("tv")).toEqual([
      [["02:00:00:00:00:02"], true],
      [["02:00:00:00:00:02"], true],
    ]);
    expect(macs("video")).toEqual([[["02:00:00:00:00:01", "02:00:00:00:00:02"], true]]);
  });

  it("keeps a policy with no one left disabled rather than dropping it", () => {
    const { policies } = plan([tvDowntime], [group("g1", { allowed: true })]);
    expect(policies.map((policy) => [policy.macAddresses, policy.enabled])).toEqual([
      [["02:00:00:00:00:01"], false],
      [["02:00:00:00:00:01"], false],
    ]);
  });

  it("never plans an internet rule without windows or on networks", () => {
    const always = { ...tvDowntime, mode: RuleMode.always };
    const network = { ...tvDowntime, id: "net", scope: RuleScope.network, networkIds: ["net-a"] };
    expect(plan([always, network]).policies).toEqual([]);
  });

  it("disables every policy of a rule turned off", () => {
    const { policies } = plan([{ ...tvDowntime, enabled: false }]);
    expect(policies.map((policy) => policy.enabled)).toEqual([false, false]);
  });

  it("retains a rule's policies while one of its devices has no zone", () => {
    const { policies, retainRuleIds } = plan([rule({})], [group("g1")], [{ ...device("02:00:00:00:00:01", "g1"), zoneId: null as unknown as string }]);
    expect(policies).toEqual([]);
    expect(retainRuleIds.has("r1")).toBe(true);
  });

  it("plans NETWORK source buckets for managed network-scoped rules", () => {
    const { policies, orphanRuleIds } = planRulePolicies({
      destinationZoneId: "ext",
      zoneNames: { "zone-1": "Internal", "zone-2": "IoT" },
      groups: [],
      devices: [],
      networks: [
        { id: "net-a", name: "Family", zoneId: "zone-1" },
        { id: "net-b", name: "IoT", zoneId: "zone-2" },
      ],
      networkScope: { manageAllNetworks: false, managedNetworkIds: ["net-a"] },
      rules: [
        rule({ id: "rn1", scope: RuleScope.network, groupIds: [], networkIds: ["net-a", "net-unmanaged"], targetIds: [24] }),
        rule({ id: "rn-orphan", kind: RuleKind.app, scope: RuleScope.network, groupIds: [], networkIds: ["net-unmanaged"], targetIds: [10001] }),
      ],
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.sourceType).toBe("NETWORK");
    expect(policies[0]?.networkIds).toEqual(["net-a"]);
    expect(policies[0]?.macAddresses).toEqual([]);
    expect(orphanRuleIds.has("rn-orphan")).toBe(true);
  });
});

describe("network-scoped rules", () => {
  const plan = (rule: PlanRule) =>
    planRulePolicies({
      destinationZoneId: "ext",
      groups: [],
      devices: [],
      networks: [
        { id: "net-a", name: "Family", zoneId: "zone-1" },
        { id: "net-z", name: "Unzoned", zoneId: null },
      ],
      networkScope: { manageAllNetworks: true, managedNetworkIds: [] },
      rules: [rule],
    });

  it("blocks websites for a whole network", () => {
    const { policies } = plan(rule({ kind: RuleKind.domain, scope: RuleScope.network, groupIds: [], networkIds: ["net-a"], targetIds: [], domains: ["example.com"] }));
    const write = rulePolicyWrite(policies[0]!);
    expect(write.source.trafficFilter).toEqual({ type: "NETWORK", networkFilter: { matchOpposite: false, networkIds: ["net-a"] } });
    expect(write.destination.trafficFilter).toEqual({ type: "DOMAIN", domainFilter: { type: "DOMAINS", domains: ["example.com"] } });
  });

  it("retains a rule's policies while one of its networks has no zone", () => {
    const { policies, retainRuleIds } = plan(rule({ scope: RuleScope.network, groupIds: [], networkIds: ["net-a", "net-z"] }));
    expect(policies.map((policy) => policy.networkIds)).toEqual([["net-a"]]);
    expect(retainRuleIds.has("r1")).toBe(true);
  });
});

describe("rulePolicyWrite", () => {
  it("blocks all traffic for an internet rule and matches domains for a website rule", () => {
    const [internet] = plan([tvDowntime]).policies;
    expect(rulePolicyWrite(internet!).destination).toEqual({ zoneId: "ext" });
    const [website] = plan([rule({ kind: RuleKind.domain, targetIds: [], domains: ["tiktokcdn.com", "tiktok.com"] })]).policies;
    const write = rulePolicyWrite(website!);
    expect(write.destination).toEqual({
      zoneId: "ext",
      trafficFilter: { type: "DOMAIN", domainFilter: { type: "DOMAINS", domains: ["tiktok.com", "tiktokcdn.com"] } },
    });
    expect(write.source.trafficFilter).toEqual({ type: "MAC_ADDRESS", macAddressFilter: { macAddresses: ["02:00:00:00:00:01"] } });
  });

  it("uses the category and app DPI shapes", () => {
    const [category] = plan([rule({})]).policies;
    expect(rulePolicyWrite(category!).destination.trafficFilter).toEqual({
      type: "APPLICATION_CATEGORY",
      applicationCategoryFilter: { applicationCategoryIds: [4] },
    });
    const [app] = plan([rule({ kind: RuleKind.app, targetIds: [10001] })]).policies;
    expect(rulePolicyWrite(app!).destination.trafficFilter).toEqual({
      type: "APPLICATION",
      applicationFilter: { applicationIds: [10001] },
    });
  });
});
