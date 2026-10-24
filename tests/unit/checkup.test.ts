import { describe, expect, it } from "vitest";
import {
  checkupCopy,
  checkupSummary,
  isPrivateMac,
  openProblemCount,
  outsideDnsNote,
  protectionLine,
  protectionTitle,
  recommendedRules,
  runChecks,
  turnOnRecommended,
  type CheckupDevice,
  type CheckupInputs,
  type CheckupNetwork,
  type CheckupWifi,
} from "@/lib/checkup";
import type { HouseholdStore } from "@/lib/household-store";
import type { Rule } from "@/lib/rules";

const LAN = "lan";
const IOT = "iot";

const network = (over: Partial<CheckupNetwork> & Pick<CheckupNetwork, "id" | "name">): CheckupNetwork => ({
  managed: true,
  mdnsForwardingEnabled: true,
  dnsServers: [],
  clientCount: 0,
  ...over,
});

const device = (over: Partial<CheckupDevice> & Pick<CheckupDevice, "mac">): CheckupDevice => ({
  hostname: null,
  manufacturer: null,
  connectionType: "wireless",
  networkId: LAN,
  groupKind: "family",
  ...over,
});

const wifi = (over: Partial<CheckupWifi> & Pick<CheckupWifi, "id" | "name">): CheckupWifi => ({
  enabled: true,
  networkId: LAN,
  frequenciesGHz: [2.4, 5],
  security: "WPA2_PERSONAL",
  multicastToUnicastConversionEnabled: false,
  clientIsolationEnabled: false,
  ...over,
});

const phone = device({ mac: "06:00:00:00:0a:01", hostname: "Sam's iPhone" });
const sonos = (n: number, connectionType: string, networkId = LAN) =>
  device({ mac: `02:00:00:00:0b:0${n}`, hostname: `Room ${n}`, manufacturer: "Sonos, Inc.", connectionType, networkId, groupKind: "things" });

const inputs = (over: Partial<CheckupInputs> = {}): CheckupInputs => ({
  devices: [],
  networks: [network({ id: LAN, name: "LAN" }), network({ id: IOT, name: "IoT" })],
  wifis: [],
  ...over,
});

const found = (run: ReturnType<typeof runChecks>, check: string) => run.findings.filter((finding) => finding.check === check);

describe("network checkup", () => {
  it("passes every check on a household with nothing to say", () => {
    const run = runChecks(inputs());
    expect(run.findings).toEqual([]);
    expect(run.skipped).toEqual([]);
    expect(run.passed).toHaveLength(8);
  });

  it("finds Sonos wired and on Wi-Fi, and only then", () => {
    expect(found(runChecks(inputs({ devices: [sonos(1, "wired"), sonos(2, "wired")] })), "sonos_mixed")).toEqual([]);
    expect(found(runChecks(inputs({ devices: [sonos(1, "wireless"), sonos(2, "wireless")] })), "sonos_mixed")).toEqual([]);
    const [mixed] = found(runChecks(inputs({ devices: [sonos(1, "wired"), sonos(2, "wireless"), sonos(3, "wireless")] })), "sonos_mixed");
    expect(mixed?.details.devices?.map((item) => [item.name, item.wired])).toEqual([
      ["Room 1", true],
      ["Room 2", false],
      ["Room 3", false],
    ]);
    expect(checkupCopy({ check: "sonos_mixed", details: mixed!.details }).seen).toBe("Room 1 is wired. Room 2 and Room 3 are on Wi-Fi.");
  });

  it("knows Sonos by maker, never guesses from nothing", () => {
    const unknown = device({ mac: "02:00:00:00:0b:09", connectionType: "wired", hostname: "Speaker" });
    expect(found(runChecks(inputs({ devices: [unknown, sonos(2, "wireless")] })), "sonos_mixed")).toEqual([]);
  });

  it("finds private Wi-Fi addresses but not a wired one", () => {
    expect(isPrivateMac("02:00:00:00:00:01")).toBe(true);
    // Built, not written out: the repository keeps vendor-assigned MACs out of tests.
    expect(isPrivateMac(`f4${":00".repeat(5)}`)).toBe(false);
    expect(isPrivateMac("fe:00:00:00:00:01")).toBe(true);
    const wired = device({ mac: "0a:00:00:00:0c:01", connectionType: "wired" });
    const vpn = device({ mac: "0a:00:00:00:0c:02", connectionType: "vpn" });
    const [finding] = found(runChecks(inputs({ devices: [phone, wired, vpn] })), "private_addresses");
    expect(finding?.details.devices?.map((item) => item.mac)).toEqual([phone.mac]);
  });

  it("finds Wi-Fi settings that break Sonos on the Wi-Fi carrying it", () => {
    const run = runChecks(
      inputs({
        devices: [sonos(1, "wireless", IOT)],
        wifis: [wifi({ id: "w1", name: "Home", multicastToUnicastConversionEnabled: true }), wifi({ id: "w2", name: "Things", networkId: IOT, clientIsolationEnabled: true })],
      }),
    );
    const [finding] = found(run, "wifi_multicast");
    expect(finding?.details.wifis).toEqual([{ id: "w2", name: "Things", settings: ["client_isolation"] }]);
    expect(checkupCopy({ check: "wifi_multicast", details: finding!.details }).seen).toBe("Things: Client Device Isolation on.");
  });

  it("skips the Wi-Fi checks when Wi-Fi could not be read, and never passes them", () => {
    const run = runChecks(inputs({ wifis: null, devices: [sonos(1, "wireless")] }));
    expect(run.skipped).toEqual(["wifi_multicast", "smart_home_wifi"]);
    expect(run.passed).not.toContain("wifi_multicast");
  });

  it("finds Sonos phones cannot reach with mDNS off, and casting targets as a note", () => {
    const tv = device({ mac: "02:00:00:00:0d:01", hostname: "Den TV", networkId: IOT, groupKind: "things" });
    const off = inputs({ devices: [phone, sonos(1, "wireless", IOT), tv], networks: [network({ id: LAN, name: "LAN" }), network({ id: IOT, name: "IoT", mdnsForwardingEnabled: false })] });
    const run = runChecks(off);
    expect(found(run, "sonos_mdns")[0]?.details.networks).toEqual([{ id: IOT, name: "IoT" }]);
    expect(found(run, "casting_mdns")[0]?.details.devices?.map((item) => item.name)).toEqual(["Den TV"]);
    // Forwarded, or on the phones' own network: nothing to say.
    expect(found(runChecks({ ...off, networks: [network({ id: LAN, name: "LAN" }), network({ id: IOT, name: "IoT" })] }), "sonos_mdns")).toEqual([]);
    expect(found(runChecks({ ...off, devices: [phone, sonos(1, "wireless", LAN)] }), "sonos_mdns")).toEqual([]);
  });

  it("notes a managed network handing out its own DNS, keyed by network", () => {
    const run = runChecks(inputs({ networks: [network({ id: LAN, name: "LAN", dnsServers: ["192.0.2.53"] }), network({ id: IOT, name: "IoT", managed: false, dnsServers: ["192.0.2.54"] })] }));
    expect(found(run, "dns_override").map((finding) => [finding.key, finding.subject])).toEqual([["dns_override:lan", "192.0.2.53"]]);
  });

  it("notes Things' Wi-Fi without 2.4 GHz or on WPA3 only", () => {
    const thing = device({ mac: "02:00:00:00:0e:01", networkId: IOT, groupKind: "things" });
    const run = runChecks(inputs({ devices: [thing], wifis: [wifi({ id: "w2", name: "Things", networkId: IOT, frequenciesGHz: [5], security: "WPA3_PERSONAL" })] }));
    expect(found(run, "smart_home_wifi")[0]?.details.wifis?.[0]?.settings).toEqual(["no_2_4_ghz", "wpa3_only"]);
  });

  it("notes networks FamilyFi does not manage that have devices", () => {
    const run = runChecks(inputs({ networks: [network({ id: LAN, name: "LAN" }), network({ id: "guest", name: "Guest", managed: false, clientCount: 3 }), network({ id: "empty", name: "Empty", managed: false })] }));
    const [finding] = found(run, "unmanaged_networks");
    expect(checkupCopy({ check: "unmanaged_networks", details: finding!.details }).title).toBe("Guest isn’t managed by FamilyFi");
    expect(checkupCopy({ check: "unmanaged_networks", details: finding!.details }).seen).toBe("3 devices on Guest get no rules or quarantine.");
    // Settings opens on Household; the managed networks are on the Gateway tab.
    expect(checkupCopy({ check: "unmanaged_networks", details: finding!.details }).show?.href).toBe("/settings?tab=gateway");
  });

  it("changes a finding's subject when what was seen changes, and keeps it when it does not", () => {
    const one = runChecks(inputs({ devices: [phone] }));
    const again = runChecks(inputs({ devices: [phone] }));
    const more = runChecks(inputs({ devices: [phone, device({ mac: "0e:00:00:00:0a:02" })] }));
    expect(found(again, "private_addresses")[0]?.subject).toBe(found(one, "private_addresses")[0]?.subject);
    expect(found(more, "private_addresses")[0]?.subject).not.toBe(found(one, "private_addresses")[0]?.subject);
  });

  it("counts open problems for the badge, never notes or dismissed ones", () => {
    expect(openProblemCount([{ kind: "problem", dismissed: false }, { kind: "problem", dismissed: true }, { kind: "note", dismissed: false }])).toBe(1);
  });

  it("sums up the last run", () => {
    const now = new Date("2026-10-22T12:10:00Z");
    expect(checkupSummary(null, now)).toBe("Not checked yet");
    const finding = (kind: "problem" | "note") => ({ id: kind, check: "dns_override" as const, kind, details: {}, firstSeenAt: "", lastSeenAt: "", dismissed: false });
    expect(checkupSummary({ ranAt: "2026-10-22T12:06:00Z", error: null, passed: [], findings: [finding("problem"), finding("note")] }, now)).toBe("1 problem · 1 note · checked 4 minutes ago");
    expect(checkupSummary({ ranAt: "2026-10-22T12:10:00Z", error: null, passed: [], findings: [] }, now)).toBe("No problems · checked just now");
  });

  it("notes in the website rule editor when covered devices use a network's own DNS", () => {
    const state = { findings: [{ id: "dns_override:lan", check: "dns_override" as const, kind: "note" as const, details: { networks: [{ id: LAN, name: "LAN", dnsServers: ["192.0.2.53"] }] }, firstSeenAt: "", lastSeenAt: "", dismissed: false }] };
    const devices = [{ groupId: "g1", networkId: LAN }];
    const rule = { kind: "domain", scope: "group", groupIds: ["g1"], networkIds: [] };
    expect(outsideDnsNote(rule, devices, state)).toContain("LAN, which uses its own DNS server (192.0.2.53)");
    // Category and app rules match traffic, not lookups.
    for (const kind of ["internet", "category", "app"]) expect(outsideDnsNote({ ...rule, kind }, devices, state)).toBeNull();
    expect(outsideDnsNote({ ...rule, groupIds: ["g2"] }, devices, state)).toBeNull();
    expect(outsideDnsNote({ ...rule, scope: "network", groupIds: [], networkIds: [LAN] }, [], state)).not.toBeNull();
    expect(outsideDnsNote(rule, devices, null)).toBeNull();
  });

  it("turns on only the recommended protection that is off", async () => {
    const sent: string[] = [];
    const mutate: HouseholdStore["mutate"] = async (run) => {
      await run(async (path) => {
        sent.push(path);
        return { rule: {} } as never;
      });
      return undefined;
    };
    const rules = [
      { id: "countries", enabled: false },
      { id: "quarantine", enabled: true },
      { id: "dns", enabled: false },
      { id: "bedtime", enabled: false },
    ] as Rule[];
    await turnOnRecommended(mutate, rules);
    expect(sent).toEqual(["/api/v1/rules/dns/on", "/api/v1/rules/countries/on"]);
  });

  it("lists quarantine, Lock DNS and Block countries, and says who each covers", () => {
    const groups = [
      { id: "g1", name: "Mia" },
      { id: "g2", name: "TVs" },
    ];
    const rules = [
      { id: "countries", builtIn: "countries", countries: ["KP"], groupIds: [] },
      { id: "dns", builtIn: "dns", countries: [], groupIds: [] },
      { id: "quarantine", builtIn: "quarantine", countries: [], groupIds: [] },
    ] as unknown as Rule[];
    expect(recommendedRules(rules).map((rule) => rule.id)).toEqual(["quarantine", "dns", "countries"]);
    expect(recommendedRules(rules).map(protectionTitle)).toEqual(["Quarantine", "Lock DNS", "Block countries"]);
    expect(protectionLine({ builtIn: "dns", countries: [], groupIds: [] }, groups)).toBe("Keeps every person off other DNS servers");
    expect(protectionLine({ builtIn: "dns", countries: [], groupIds: ["g1"] }, groups)).toBe("Keeps Mia off other DNS servers");
    expect(protectionLine({ builtIn: "countries", countries: ["KP"], groupIds: ["g1", "g2"] }, groups)).toBe("Blocks North Korea for every group");
  });
});
