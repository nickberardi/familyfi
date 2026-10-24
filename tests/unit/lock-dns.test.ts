import { isIP } from "node:net";
import { AssignmentState, GroupKind, RuleKind, RuleMode, RuleScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ENCRYPTED_DNS_SERVICES, encryptedDnsAddresses, encryptedDnsHosts, encryptedDnsSummary } from "@/lib/encrypted-dns";
import { groupHeaderActions, groupStatus } from "@/lib/group-actions";
import { fromLockDnsRule, lockDnsDirty, lockDnsOpenLabel, lockDnsSummary, lockDnsWrites, validateLockDnsDraft } from "@/lib/lock-dns";
import { rulePauseSheetBody } from "@/lib/pause-sheet";
import { ruleGroupStateLines } from "@/lib/rule-actions";
import { lockDnsParts, lockDnsPolicyName } from "@/lib/policy-names";
import { ruleMarkSpec, rulesListView } from "@/lib/rule-list";
import { groupScopedRules, LOCK_DNS_RULE_ID, normalizeDomain, ruleBlocksLabel, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { lockDnsExemptions, lockDnsExemptionsOf, lockDnsOpenDns, setLockDnsResolverForTests } from "@/server/unifi/lock-dns";
import { planRulePolicies, rulePolicyWrite, type PlanRule } from "@/server/unifi/plan-rules";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));

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
      [...lockDnsParts(false).map((part) => lockDnsPolicyName(part)), ...lockDnsParts(false).map((part) => lockDnsPolicyName(part, "IoT"))].sort(),
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

  it("turns off iCloud Private Relay as one more policy while its switch is on (experimental)", () => {
    expect(plan(planRule()).map((policy) => policy.lockDns)).not.toContain("private-relay");
    const relay = planRulePolicies({
      destinationZoneId: "ext",
      zoneNames: { "zone-1": "Internal" },
      groups: [{ id: "kid", kind: GroupKind.family }],
      devices: [device("02:00:00:00:00:01", "kid")],
      rules: [planRule({ groupIds: ["kid"], blockPrivateRelay: true })],
      // A resolver of the household's own never opens Apple's relay names.
      lockDnsExemptions: { addresses: [], hosts: ["mask.icloud.com"] },
    }).policies.find((policy) => policy.lockDns === "private-relay")!;
    expect(relay.name).toBe("FamilyFi Lock DNS Private Relay");
    const write = rulePolicyWrite(relay);
    expect(write.source.trafficFilter).toEqual({ type: "MAC_ADDRESS", macAddressFilter: { macAddresses: ["02:00:00:00:00:01"] } });
    expect(write.destination.trafficFilter).toEqual({ type: "DOMAIN", domainFilter: { type: "DOMAINS", domains: ["mask-h2.icloud.com", "mask.icloud.com"] } });
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

describe("Lock DNS leaves the household's own DNS alone", () => {
  const own = { addresses: ["1.1.1.3", "45.90.28.10"], hosts: ["family.cloudflare-dns.com"] };
  const policies = planRulePolicies({
    destinationZoneId: "ext",
    groups: [{ id: "kid", kind: GroupKind.family }],
    devices: [device("02:00:00:00:00:01", "kid")],
    rules: [planRule({ groupIds: ["kid"] })],
    lockDnsExemptions: own,
  }).policies;
  const write = (part: string) => rulePolicyWrite(policies.find((policy) => policy.lockDns === part)!);
  const items = (part: string) => (write(part).destination.trafficFilter as { ipAddressFilter: { items: { value: string }[] } }).ipAddressFilter.items.map((item) => item.value);

  it("blocks DNS and DNS over TLS to every address but the household's own servers", () => {
    expect(write("ports").destination.trafficFilter).toEqual({
      type: "IP_ADDRESS",
      ipAddressFilter: { type: "IP_ADDRESSES", matchOpposite: true, items: [{ type: "IP_ADDRESS", value: "1.1.1.3" }, { type: "IP_ADDRESS", value: "45.90.28.10" }] },
      portFilter: { type: "PORTS", matchOpposite: false, items: [{ type: "PORT_NUMBER", value: 53 }, { type: "PORT_NUMBER", value: 853 }] },
    });
  });

  it("leaves its servers' addresses, the subnets holding them, and its resolvers' names out", () => {
    expect(items("addresses")).toContain("1.1.1.1");
    expect(items("addresses")).not.toContain("1.1.1.3");
    expect(items("addresses")).not.toContain("45.90.28.0/24");
    expect(items("addresses")).toContain("45.90.30.0/24");
    const names = (write("names").destination.trafficFilter as { domainFilter: { domains: string[] } }).domainFilter.domains;
    // Blocking cloudflare-dns.com would block family.cloudflare-dns.com with it.
    expect(names).not.toContain("cloudflare-dns.com");
    expect(names).toContain("dns.google");
  });

  it("plans no policy for a part left with nothing to block", () => {
    const everyV6 = encryptedDnsAddresses("ipv6").map((entry) => entry.split("/")[0]!);
    const parts = planRulePolicies({
      destinationZoneId: "ext",
      groups: [{ id: "kid", kind: GroupKind.family }],
      devices: [device("02:00:00:00:00:01", "kid")],
      rules: [planRule({ groupIds: ["kid"] })],
      lockDnsExemptions: { addresses: everyV6, hosts: [] },
    }).policies.map((policy) => policy.lockDns);
    expect(parts).toEqual(["ports", "addresses", "names"]);
  });

  it("finds the servers its networks hand out and the resolvers set in FamilyFi", async () => {
    setLockDnsResolverForTests(async (host) => {
      if (host === "family.cloudflare-dns.com") return ["1.0.0.3", "1.1.1.3", "2606:4700:4700::1113"];
      throw new Error("no such host");
    });
    try {
      const network = (servers: string[] | null) => ({ enabled: true, ipv4Configuration: { hostIpAddress: "192.168.1.1", prefixLength: 24, dhcpConfiguration: { mode: "SERVER", dnsServerIpAddressesOverride: servers } } });
      const exempt = await lockDnsExemptions({
        networks: [network(["9.9.9.11", "192.168.1.53"]), network(null)],
        resolverUrls: ["https://family.cloudflare-dns.com/dns-query", null, "https://missing.example/dns-query", "https://[2620:fe::11]/dns-query", "not a resolver address"],
      });
      expect(exempt).not.toBeNull();
      // A server on the network itself, like a Pi-hole, needs nothing; a name that cannot be looked up keeps only its name open.
      expect(exempt).toEqual({
        addresses: ["1.0.0.3", "1.1.1.3", "2606:4700:4700::1113", "2620:fe::11", "9.9.9.11"].sort(),
        hosts: ["family.cloudflare-dns.com", "missing.example"],
      });
    } finally {
      setLockDnsResolverForTests(undefined);
    }
  });
});

describe("the DNS Lock DNS leaves open", () => {
  it("names each server by where it comes from, for its page", async () => {
    setLockDnsResolverForTests(async (host) => {
      if (host === "dns.nextdns.io") return ["45.90.30.0", "45.90.28.0"];
      throw new Error("no such host");
    });
    try {
      const network = (name: string, servers: string[]) => ({
        name,
        enabled: true,
        ipv4Configuration: { hostIpAddress: "192.168.1.1", prefixLength: 24, dhcpConfiguration: { mode: "SERVER", dnsServerIpAddressesOverride: servers } },
      });
      const open = await lockDnsOpenDns({
        networks: [network("IoT", ["9.9.9.9", "192.168.1.53"]), network("LAN", ["192.168.1.53"])],
        resolvers: [
          { source: "household", name: null, url: "https://dns.nextdns.io/abc123" },
          { source: "group", name: "Emma", url: "https://missing.example/dns-query" },
          { source: "group", name: "Abby", url: null },
        ],
      });
      // A server on the household's own network needs nothing, so LAN has no entry.
      expect(open).toEqual([
        { source: "network", name: "IoT", host: null, addresses: ["9.9.9.9"] },
        { source: "household", name: null, host: "dns.nextdns.io", addresses: ["45.90.28.0", "45.90.30.0"] },
        { source: "group", name: "Emma", host: "missing.example", addresses: [] },
      ]);
      expect(lockDnsExemptionsOf(open!)).toEqual({ addresses: ["45.90.28.0", "45.90.30.0", "9.9.9.9"], hosts: ["dns.nextdns.io", "missing.example"] });
    } finally {
      setLockDnsResolverForTests(undefined);
    }
  });
});

describe("working out the household's own DNS", () => {
  const network = (patch: Partial<{ enabled: boolean; mode: string; read: boolean }> = {}) => ({
    enabled: patch.enabled ?? true,
    ...(patch.read === false
      ? { detailsUnread: true }
      : { ipv4Configuration: { hostIpAddress: "192.168.1.1", prefixLength: 24, dhcpConfiguration: { mode: patch.mode ?? "SERVER", dnsServerIpAddressesOverride: ["1.1.1.3"] } } }),
  });

  it("gives up for the pass when a gateway network's details could not be read", async () => {
    expect(await lockDnsExemptions({ networks: [network(), network({ read: false })], resolverUrls: [] })).toBeNull();
    // A disabled network's details do not matter.
    expect(await lockDnsExemptions({ networks: [network(), network({ read: false, enabled: false })], resolverUrls: [] })).toEqual({ addresses: ["1.1.1.3"], hosts: [] });
  });

  it("takes servers only from a network's own enabled DHCP server", async () => {
    expect(await lockDnsExemptions({ networks: [network({ mode: "RELAY" }), network({ enabled: false })], resolverUrls: [] })).toEqual({ addresses: [], hosts: [] });
  });

  it("looks every resolver up at once, so slow ones never add up", async () => {
    let inFlight = 0;
    let most = 0;
    setLockDnsResolverForTests(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [];
    });
    try {
      await lockDnsExemptions({ networks: [], resolverUrls: ["https://a.example/dns-query", "https://b.example/dns-query", "https://c.example/dns-query"] });
      expect(most).toBe(3);
    } finally {
      setLockDnsResolverForTests(undefined);
    }
  });

  it("on a real gateway, asks the system resolver, and gives up on one that is slow", async () => {
    vi.stubEnv("FAMILYFI_MODE", "prod");
    vi.useFakeTimers();
    let fail: (error: Error) => void = () => {};
    dnsLookup.mockImplementation(async (host: string) => {
      if (host === "fast.example") return [{ address: "192.0.2.10", family: 4 }];
      return new Promise((_, reject) => (fail = reject));
    });
    try {
      expect(await lockDnsExemptions({ networks: [], resolverUrls: ["https://fast.example/dns-query"] })).toEqual({ addresses: ["192.0.2.10"], hosts: ["fast.example"] });
      expect(dnsLookup).toHaveBeenCalledWith("fast.example", { all: true });
      const slow = lockDnsExemptions({ networks: [], resolverUrls: ["https://slow.example/dns-query"] });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await slow).toEqual({ addresses: [], hosts: ["slow.example"] });
      // Vitest fails the run on an unhandled rejection; the race has already handled this late one.
      fail(new Error("ETIMEOUT"));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      setLockDnsResolverForTests(undefined);
    }
  });

  it("never looks a resolver up for the UniFi mock", async () => {
    vi.stubEnv("FAMILYFI_MODE", "dev");
    dnsLookup.mockClear();
    try {
      expect(await lockDnsExemptions({ networks: [], resolverUrls: ["https://mock.example/dns-query"] })).toEqual({ addresses: [], hosts: ["mock.example"] });
      expect(dnsLookup).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      setLockDnsResolverForTests(undefined);
    }
  });

  it("keeps a resolver's last addresses when a lookup fails", async () => {
    let answer: string[] | null = ["9.9.9.11"];
    setLockDnsResolverForTests(async () => {
      if (!answer) throw new Error("timed out");
      return answer;
    });
    vi.useFakeTimers({ now: new Date("2026-10-22T12:00:00Z") });
    try {
      const own = () => lockDnsExemptions({ networks: [], resolverUrls: ["https://dns11.quad9.net/dns-query"] });
      expect((await own())!.addresses).toEqual(["9.9.9.11"]);
      answer = null;
      vi.setSystemTime(new Date("2026-10-22T14:00:00Z"));
      expect((await own())!.addresses).toEqual(["9.9.9.11"]);
      answer = ["9.9.9.12"];
      expect((await own())!.addresses).toEqual(["9.9.9.12"]);
    } finally {
      vi.useRealTimers();
      setLockDnsResolverForTests(undefined);
    }
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
  countries: [],
  blockPrivateRelay: false,
  openDns: [],
  enabled: true,
  pause: { active: false, until: null, kind: "pause", by: null },
  groupPauses: [],
  mode: "always",
  windows: [],
  useGeneratedName: false,
  policyNames: [],
  builtIn: "dns",
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

  it("says an allowance lets a group use any DNS server, never that it unblocks it", () => {
    const allowed = { ...lockDns, groupPauses: [{ groupId: "kid", pause: { active: true, until: null, kind: "allow" as const, by: null } }] };
    expect(ruleGroupStateLines(allowed, { kid: "Emma" }, "America/New_York", now)).toEqual(["Allowed for Emma until resumed"]);
    expect(rulePauseSheetBody(lockDns, "pause")).toBe("The groups it covers can use any DNS server until it ends. Their rules and pauses stay as they are.");
    expect(rulePauseSheetBody({ ...lockDns, scope: "network" }, "pause")).toBe(
      "Everything on its networks can use any DNS server until it ends. Other rules, and any pause on a group, stay as they are.",
    );
  });

  it("reads as a narrow rule with a shield", () => {
    expect(ruleMarkSpec(lockDns)).toEqual({ shape: "round", icon: "shield-check" });
    expect(ruleBlocksLabel(lockDns, new Map())).toBe("Other DNS servers · everything else stays on");
  });

  it("shows what saving what it applies to writes", () => {
    const groups = (...groupIds: string[]) => ({ scope: "group" as const, groupIds, networkIds: [], blockPrivateRelay: false });
    const networks = (...networkIds: string[]) => ({ scope: "network" as const, groupIds: [], networkIds, blockPrivateRelay: false });
    expect(lockDnsWrites(groups(), groups())).toEqual([]);
    expect(lockDnsWrites(groups(), groups("kid")).map((write) => write.verb)).toEqual(["NEW", "NEW", "NEW", "NEW"]);
    expect(lockDnsWrites(groups("kid"), groups("kid")).map((write) => write.verb)).toEqual(["KEEP", "KEEP", "KEEP", "KEEP"]);
    expect(lockDnsWrites(groups("kid"), groups("kid", "teen")).map((write) => write.detail)).toEqual(Array(4).fill("Applies to changed"));
    expect(lockDnsWrites(groups("kid"), networks("lan")).map((write) => write.verb)).toEqual(["CHANGE", "CHANGE", "CHANGE", "CHANGE"]);
    expect(lockDnsWrites(groups("kid"), groups()).map((write) => write.verb)).toEqual(["DELETE", "DELETE", "DELETE", "DELETE"]);
    expect(lockDnsWrites(groups("kid"), networks()).map((write) => write.verb)).toEqual(["KEEP", "KEEP", "KEEP", "KEEP"]);
    expect(lockDnsWrites(groups(), networks("lan")).map((write) => write.name)).toEqual(lockDnsParts(false).map((part) => lockDnsPolicyName(part)));
  });

  it("shows Private Relay's policy coming and going with its switch", () => {
    const kid = { scope: "group" as const, groupIds: ["kid"], networkIds: [], blockPrivateRelay: false };
    const relay = { ...kid, blockPrivateRelay: true };
    const writes = (saved: typeof kid, draft: typeof kid) => lockDnsWrites(saved, draft).map((write) => `${write.verb} ${write.name}`);
    expect(writes(kid, relay)).toEqual([...lockDnsParts(false).map((part) => `KEEP ${lockDnsPolicyName(part)}`), "NEW FamilyFi Lock DNS Private Relay"]);
    expect(writes(relay, kid).at(-1)).toBe("DELETE FamilyFi Lock DNS Private Relay");
    expect(writes(relay, { ...relay, groupIds: ["kid", "teen"] }).at(-1)).toBe("CHANGE FamilyFi Lock DNS Private Relay");
    // Switched on while it applies to nothing, it writes nothing.
    expect(writes({ ...kid, groupIds: [] }, { ...relay, groupIds: [] })).toEqual([]);
    expect(lockDnsDirty(kid, relay)).toBe(true);
    expect(lockDnsSummary(kid)).toBe("Built in · always · 4 UniFi policies");
    expect(lockDnsSummary(relay)).toBe("Built in · always · 5 UniFi policies");
  });

  it("reads the rule as the server sends it, without the other scope's list or the switch", () => {
    // Lock DNS on people carries no networkIds; on networks, no groupIds. blockPrivateRelay is only on Lock DNS.
    expect(fromLockDnsRule({ scope: "group", groupIds: ["kid"] })).toEqual({ scope: "group", groupIds: ["kid"], networkIds: [], blockPrivateRelay: false });
    expect(fromLockDnsRule({ scope: "network", networkIds: ["lan"], blockPrivateRelay: true })).toEqual({
      scope: "network",
      groupIds: [],
      networkIds: ["lan"],
      blockPrivateRelay: true,
    });
    expect(lockDnsDirty({ scope: "group", groupIds: ["kid"] }, { scope: "group", groupIds: ["kid"], networkIds: [], blockPrivateRelay: false })).toBe(false);
  });

  it("names who each DNS it leaves open belongs to", () => {
    expect(lockDnsOpenLabel({ source: "household", name: null })).toBe("Household resolver");
    expect(lockDnsOpenLabel({ source: "group", name: "Emma" })).toBe("Emma’s resolver");
    expect(lockDnsOpenLabel({ source: "network", name: "IoT" })).toBe("Handed out by IoT");
  });

  it("knows when what it applies to differs from the saved rule", () => {
    const saved = { scope: "group" as const, groupIds: ["kid", "teen"], networkIds: [], blockPrivateRelay: false };
    expect(lockDnsDirty(saved, { ...saved, groupIds: ["teen", "kid"] })).toBe(false);
    expect(lockDnsDirty(saved, { ...saved, groupIds: ["teen"] })).toBe(true);
    // Networks picked and left behind on the other tab are not a change.
    expect(lockDnsDirty(saved, { ...saved, networkIds: ["lan"] })).toBe(false);
    expect(lockDnsDirty(saved, { ...saved, scope: "network", networkIds: ["lan"] })).toBe(true);
    // No group is allowed; whole networks need at least one, as for any rule.
    expect(validateLockDnsDraft({ ...saved, groupIds: [] })).toBeNull();
    expect(validateLockDnsDraft({ ...saved, scope: "network" })).toBe("Pick at least one network.");
  });
});
