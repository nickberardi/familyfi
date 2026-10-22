import { isIP } from "node:net";
import { AssignmentState, GroupKind, RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ENCRYPTED_DNS_SERVICES, encryptedDnsAddresses, encryptedDnsHosts, encryptedDnsSummary } from "@/lib/encrypted-dns";
import { groupHeaderActions, groupStatus } from "@/lib/group-actions";
import { lockDnsDirty, lockDnsWrites, toggleLockDnsGroup } from "@/lib/lock-dns";
import { LOCK_DNS_PARTS, lockDnsPolicyName } from "@/lib/policy-names";
import { ruleMarkSpec, rulesListView } from "@/lib/rule-list";
import { groupScopedRules, LOCK_DNS_RULE_ID, normalizeDomain, ruleBlocksLabel, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { planRulePolicies, rulePolicyWrite, type PlanRule } from "@/server/unifi/plan-rules";

const planRule = (patch: Partial<PlanRule> = {}): PlanRule => ({
  id: LOCK_DNS_RULE_ID,
  name: "Lock DNS",
  useGeneratedName: false,
  kind: RuleKind.domain,
  scope: RuleScope.group,
  groupIds: ["kid", "teen"],
  networkIds: [],
  targetIds: [],
  domains: [],
  enabled: true,
  paused: false,
  system: false,
  liftedGroupIds: [],
  mode: RuleMode.always,
  windows: [],
  ...patch,
});

const device = (mac: string, groupId: string, zoneId = "zone-1") => ({ mac, assignment: AssignmentState.assigned, groupId, zoneId, inScope: true });

const plan = (rule: PlanRule, devices = [device("02:00:00:00:00:01", "kid"), device("02:00:00:00:00:02", "teen")]) =>
  planRulePolicies({
    destinationZoneId: "ext",
    zoneNames: { "zone-1": "Internal", "zone-2": "IoT" },
    groups: [
      { id: "kid", kind: GroupKind.family },
      { id: "teen", kind: GroupKind.family },
    ],
    devices,
    rules: [rule],
  }).policies;

describe("Lock DNS policies", () => {
  it("plans one always-on policy per part in each zone, named for the part and zone", () => {
    const policies = plan(planRule(), [device("02:00:00:00:00:01", "kid"), device("02:00:00:00:00:02", "teen", "zone-2")]);
    expect(policies.map((policy) => policy.name).sort()).toEqual(
      [...LOCK_DNS_PARTS.map((part) => lockDnsPolicyName(part)), ...LOCK_DNS_PARTS.map((part) => lockDnsPolicyName(part, "IoT"))].sort(),
    );
    expect(policies.map((policy) => policy.key)).toContain(`rule:${LOCK_DNS_RULE_ID}:addresses-v6|zone-2`);
    expect(policies.every((policy) => policy.enabled && !policy.schedule)).toBe(true);
    expect(lockDnsPolicyName("names", "IoT")).toBe("FamilyFi Lock DNS names (IoT)");
  });

  it("blocks TCP and UDP 53 and 853 to the internet zone, from the covered devices", () => {
    const ports = plan(planRule()).find((policy) => policy.lockDns === "ports")!;
    const write = rulePolicyWrite(ports);
    expect(write.action).toEqual({ type: "BLOCK" });
    expect(write.source.trafficFilter).toEqual({ type: "MAC_ADDRESS", macAddressFilter: { macAddresses: ["02:00:00:00:00:01", "02:00:00:00:00:02"] } });
    expect(write.ipProtocolScope).toEqual({ ipVersion: "IPV4_AND_IPV6", protocolFilter: { type: "PRESET", preset: { name: "TCP_UDP" } } });
    expect(write.destination).toEqual({
      zoneId: "ext",
      trafficFilter: {
        type: "PORT",
        portFilter: { type: "PORTS", matchOpposite: false, items: [{ type: "PORT_NUMBER", value: 53 }, { type: "PORT_NUMBER", value: 853 }] },
      },
    });
  });

  it("blocks every port to the services' addresses, one IP version per policy, and their host names", () => {
    const policies = plan(planRule());
    const write = (part: string) => rulePolicyWrite(policies.find((policy) => policy.lockDns === part)!);
    const v4 = write("addresses");
    expect(v4.ipProtocolScope).toEqual({ ipVersion: "IPV4" });
    expect(v4.destination.trafficFilter).toMatchObject({ type: "IP_ADDRESS", ipAddressFilter: { type: "IP_ADDRESSES", matchOpposite: false } });
    const v4Items = (v4.destination.trafficFilter as { ipAddressFilter: { items: { type: string; value: string }[] } }).ipAddressFilter.items;
    expect(v4Items).toContainEqual({ type: "IP_ADDRESS", value: "1.1.1.1" });
    expect(v4Items).toContainEqual({ type: "SUBNET", value: "45.90.28.0/24" });
    expect(v4Items.every((item) => isIP(item.value.split("/")[0]!) === 4)).toBe(true);
    const v6 = write("addresses-v6");
    expect(v6.ipProtocolScope).toEqual({ ipVersion: "IPV6" });
    const v6Items = (v6.destination.trafficFilter as { ipAddressFilter: { items: { value: string }[] } }).ipAddressFilter.items;
    expect(v6Items.every((item) => isIP(item.value.split("/")[0]!) === 6)).toBe(true);
    expect(write("names").destination.trafficFilter).toEqual({ type: "DOMAIN", domainFilter: { type: "DOMAINS", domains: encryptedDnsHosts() } });
  });

  it("leaves a group it is allowed for out, and keeps its policies disabled while paused or off", () => {
    const allowed = plan(planRule({ liftedGroupIds: ["kid"] }));
    expect(allowed.every((policy) => policy.macAddresses.join() === "02:00:00:00:00:02")).toBe(true);
    expect(plan(planRule({ paused: true })).every((policy) => !policy.enabled)).toBe(true);
    expect(plan(planRule({ enabled: false })).every((policy) => !policy.enabled)).toBe(true);
  });

  it("plans nothing while it covers no device, and never for whole networks", () => {
    expect(plan(planRule({ groupIds: [] }))).toEqual([]);
    expect(plan(planRule({ scope: RuleScope.network, groupIds: [], networkIds: ["net"] }))).toEqual([]);
  });
});

describe("encrypted DNS services", () => {
  it("lists valid, unique addresses and host names", () => {
    for (const version of ["ipv4", "ipv6"] as const) {
      const addresses = ENCRYPTED_DNS_SERVICES.flatMap((service) => service[version]);
      expect(new Set(addresses).size).toBe(addresses.length);
      for (const value of addresses) {
        const [address, bits] = value.split("/");
        expect(isIP(address!), value).toBe(version === "ipv4" ? 4 : 6);
        if (bits !== undefined) expect(Number(bits), value).toBeLessThanOrEqual(version === "ipv4" ? 32 : 128);
      }
    }
    for (const host of encryptedDnsHosts()) expect(normalizeDomain(host)).toBe(host);
    expect(encryptedDnsAddresses("ipv4")).toContain("8.8.8.8");
    expect(encryptedDnsSummary()).toBe(`Cloudflare, Google, Quad9, OpenDNS, NextDNS, AdGuard and ${ENCRYPTED_DNS_SERVICES.length - 6} more`);
  });
});

const group = (id: string, overrides: Partial<Group> = {}): Group => ({
  id,
  kind: "family",
  name: id,
  monogram: null,
  familyRole: "child",
  deviceCount: 1,
  suspension: { active: false, until: null, by: null },
  allowance: { active: false, until: null, by: null },
  internetRuleIds: [],
  dohOverrideUrl: null,
  access: "available",
  ...overrides,
});

const lockDns: Rule = {
  id: LOCK_DNS_RULE_ID,
  name: "Lock DNS",
  kind: "domain",
  scope: "group",
  groupIds: ["kid"],
  networkIds: [],
  targetIds: [],
  domains: encryptedDnsHosts(),
  enabled: true,
  pause: { active: false, until: null, kind: "pause", by: null },
  groupPauses: [],
  mode: "always",
  windows: [],
  useGeneratedName: false,
  policyNames: [],
  builtIn: "lockDns",
};

describe("Lock DNS on the clients", () => {
  const now = new Date("2026-10-15T20:30:00Z");

  it("never blocks the group it covers: its status, button and rule list leave it out", () => {
    const kid = group("kid");
    expect(groupScopedRules([lockDns], "kid")).toEqual([]);
    expect(groupStatus(kid, [lockDns], "America/New_York", now).tone).toBe("on");
    expect(groupHeaderActions(kid, [lockDns], "America/New_York", now).action.run).toBe("block");
  });

  it("lists on Rules for its groups, without counting as a rule that filters them", () => {
    const view = rulesListView([lockDns], [group("kid"), group("adult")], "kid");
    expect(view.list).toEqual([lockDns]);
    expect(view.chips.map((item) => item.id)).toEqual(["kid"]);
    expect(rulesListView([lockDns], [group("kid")], null).unruled).toEqual(["kid"]);
  });

  it("reads as a narrow rule with a shield", () => {
    expect(ruleMarkSpec(lockDns)).toEqual({ shape: "round", icon: "shield-check" });
    expect(ruleBlocksLabel(lockDns, new Map())).toBe("Other DNS servers · everything else stays on");
  });

  it("shows what saving its groups writes", () => {
    expect(lockDnsWrites([], [])).toEqual([]);
    expect(lockDnsWrites([], ["kid"]).map((write) => write.verb)).toEqual(["NEW", "NEW", "NEW", "NEW"]);
    expect(lockDnsWrites(["kid"], ["kid"]).map((write) => write.verb)).toEqual(["KEEP", "KEEP", "KEEP", "KEEP"]);
    expect(lockDnsWrites(["kid"], ["kid", "teen"]).map((write) => write.detail)).toEqual(Array(4).fill("Groups changed"));
    expect(lockDnsWrites(["kid"], []).map((write) => write.verb)).toEqual(["DELETE", "DELETE", "DELETE", "DELETE"]);
    expect(lockDnsWrites([], ["kid"]).map((write) => write.name)).toEqual(LOCK_DNS_PARTS.map((part) => lockDnsPolicyName(part)));
  });

  it("picks and drops groups, and knows when they differ from the saved ones", () => {
    expect(toggleLockDnsGroup(["kid"], "teen")).toEqual(["kid", "teen"]);
    expect(toggleLockDnsGroup(["kid", "teen"], "kid")).toEqual(["teen"]);
    expect(lockDnsDirty({ groupIds: ["kid", "teen"] }, ["teen", "kid"])).toBe(false);
    expect(lockDnsDirty({ groupIds: ["kid"] }, ["teen"])).toBe(true);
  });
});
