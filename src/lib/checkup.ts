/**
 * The network checkup: what FamilyFi can see about the household's network that is worth knowing,
 * as pure checks over what sync reads, and the words every client shows for each finding. FamilyFi
 * only reads and explains; it never changes the gateway because of a finding.
 *
 * A finding is a `problem` when it is almost never intended (it counts on the nav badge) or a `note`
 * when it may be by design: a note says what FamilyFi sees and what it means for FamilyFi's rules,
 * never that it is wrong.
 */
import type { ApiRequest } from "./api-client";
import { countriesSummary } from "./countries";
import { deviceKindLabel } from "./display";
import type { HouseholdStore } from "./household-store";
import type { IconName } from "./icons";
import { COUNTRIES_RULE_ID, LOCK_DNS_RULE_ID, QUARANTINE_RULE_ID, type Rule } from "./rules";

export const CHECKUP_CHECKS = [
  "sonos_mixed",
  "private_addresses",
  "wifi_multicast",
  "sonos_mdns",
  "casting_mdns",
  "dns_override",
  "smart_home_wifi",
  "unmanaged_networks",
] as const;
export type CheckupCheck = (typeof CHECKUP_CHECKS)[number];
export type CheckupKind = "problem" | "note";

export const CHECK_KIND: Record<CheckupCheck, CheckupKind> = {
  sonos_mixed: "problem",
  private_addresses: "problem",
  wifi_multicast: "problem",
  sonos_mdns: "problem",
  casting_mdns: "note",
  dns_override: "note",
  smart_home_wifi: "note",
  unmanaged_networks: "note",
};

/** A device as the checks read it. `groupKind` is null while it is unassigned. */
export type CheckupDevice = {
  mac: string;
  hostname: string | null;
  manufacturer: string | null;
  connectionType: string | null;
  networkId: string | null;
  groupKind: "family" | "things" | null;
};

/** A network as the checks read it. `clientCount` counts every client UniFi sees on it, managed or not. */
export type CheckupNetwork = {
  id: string;
  name: string;
  managed: boolean;
  /** Null when UniFi did not say (a network that is not the gateway's). */
  mdnsForwardingEnabled: boolean | null;
  /** DNS servers the network's DHCP hands out instead of the gateway; empty when it hands out the gateway. */
  dnsServers: string[];
  clientCount: number;
};

/** A Wi-Fi network (SSID) as the checks read it. */
export type CheckupWifi = {
  id: string;
  name: string;
  enabled: boolean;
  /** The network it carries. */
  networkId: string | null;
  /** 2.4, 5 and 6; null when UniFi did not say. */
  frequenciesGHz: number[] | null;
  /** UniFi's security type, e.g. `WPA2_PERSONAL`, `WPA3_PERSONAL`. */
  security: string;
  multicastToUnicastConversionEnabled: boolean;
  clientIsolationEnabled: boolean;
};

export type CheckupInputs = {
  devices: CheckupDevice[];
  networks: CheckupNetwork[];
  /** Null when the Wi-Fi networks could not be read, so the Wi-Fi checks did not run. */
  wifis: CheckupWifi[] | null;
};

export type CheckupRef = { id: string; name: string };

/** What a finding is about. Devices are named by `mac`; networks and Wi-Fi by id. */
export type CheckupDetails = {
  devices?: { mac: string; name: string; wired?: boolean }[];
  networks?: (CheckupRef & { dnsServers?: string[]; clientCount?: number })[];
  wifis?: (CheckupRef & { settings: string[] })[];
};

export type CheckupResult = {
  /** The check and what it is about, so a run updates the same finding. */
  key: string;
  check: CheckupCheck;
  details: CheckupDetails;
  /** A fingerprint of what was seen; a dismissal holds only while it is the one dismissed. */
  subject: string;
};

export type CheckupRun = { findings: CheckupResult[]; passed: CheckupCheck[]; skipped: CheckupCheck[] };

/** A finding as `GET /checkup` returns it. */
export type CheckupFinding = {
  id: string;
  check: CheckupCheck;
  kind: CheckupKind;
  details: CheckupDetails;
  firstSeenAt: string;
  lastSeenAt: string;
  dismissed: boolean;
};

export type CheckupState = {
  ranAt: string | null;
  /** Why the last run could not finish, or null. */
  error: string | null;
  findings: CheckupFinding[];
  passed: CheckupCheck[];
};

/**
 * A private ("randomised") Wi-Fi address: the locally administered bit is set, so the second hex
 * digit is 2, 6, A or E. Phones make one per network and may change it, which makes them look new.
 */
export function isPrivateMac(mac: string): boolean {
  const second = mac.trim().toLowerCase()[1];
  return second === "2" || second === "6" || second === "a" || second === "e";
}

/** The devices whose address is a private Wi-Fi one. */
export function privateAddressDevices<T extends { mac: string; connectionType: string | null }>(devices: T[]): T[] {
  // Wi-Fi, or not known yet (an offline device): a VPN or Teleport client's address is not a phone's.
  return devices.filter((device) => (device.connectionType === "wireless" || device.connectionType === null) && isPrivateMac(device.mac));
}

/** What Devices and a device's page say about a private Wi-Fi address. */
export const PRIVATE_ADDRESS_COPY = {
  notice: (count: number) => `${plural(count, "device uses", "devices use")} a private Wi-Fi address`,
  noticeBody: "Their address can change, so they can come back as new, unassigned devices and lose their rules.",
  showThem: "Show them",
  showAll: "Show all devices",
  mark: "Private",
  markLabel: "Private Wi-Fi address",
  cardTitle: "Private Wi-Fi address",
  cardBody: "This device hides its real address on this Wi-Fi, and the address can change. When it does, FamilyFi sees a new, unassigned device and this one loses its group’s rules.",
  howToFix: "How to fix",
  iphone: { label: "iPhone and iPad:", steps: "Settings → Wi-Fi → (i) next to this network → Private Wi-Fi Address → Fixed." },
  android: { label: "Android:", steps: "Settings → Wi-Fi → this network → Privacy → Use device MAC." },
} as const;

const isSonos = (device: CheckupDevice) => /sonos/i.test(device.manufacturer ?? "") || /sonos/i.test(device.hostname ?? "");
const isPhone = (device: CheckupDevice) => ["Phone", "Tablet"].includes(deviceKindLabel(device.hostname)) || (device.groupKind === "family" && device.connectionType === "wireless");
/** Things phones cast to or find by mDNS: TVs, speakers and printers, by hostname or maker. */
const isCastTarget = (device: CheckupDevice) =>
  ["TV", "Speaker", "Printer"].includes(deviceKindLabel(device.hostname)) || /sonos|roku|google|brother|epson|canon/i.test(device.manufacturer ?? "");
const wired = (device: CheckupDevice) => device.connectionType === "wired";
const wireless = (device: CheckupDevice) => device.connectionType === "wireless";

function deviceName(device: CheckupDevice): string {
  return device.hostname?.trim() || device.mac;
}

const byName = <T extends { name: string }>(items: T[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));
const ids = (values: string[]) => [...values].sort().join(",");

/** Every check over what sync read. Each check either finds something, passes, or is skipped because it could not look. */
export function runChecks(inputs: CheckupInputs): CheckupRun {
  const findings: CheckupResult[] = [];
  const passed: CheckupCheck[] = [];
  const skipped: CheckupCheck[] = [];
  const networks = new Map(inputs.networks.map((network) => [network.id, network]));
  const add = (check: CheckupCheck, found: CheckupResult[]) => {
    if (found.length) findings.push(...found);
    else passed.push(check);
  };
  const deviceRefs = (devices: CheckupDevice[]) => byName(devices.map((device) => ({ mac: device.mac, name: deviceName(device) })));

  // Sonos wired and on Wi-Fi.
  const sonos = inputs.devices.filter(isSonos);
  const sonosWired = sonos.filter(wired);
  const sonosWireless = sonos.filter(wireless);
  add(
    "sonos_mixed",
    sonosWired.length && sonosWireless.length
      ? [
          {
            key: "sonos_mixed",
            check: "sonos_mixed",
            details: { devices: byName(sonos.filter((device) => wired(device) || wireless(device)).map((device) => ({ mac: device.mac, name: deviceName(device), wired: wired(device) }))) },
            subject: `wired:${ids(sonosWired.map((device) => device.mac))};wireless:${ids(sonosWireless.map((device) => device.mac))}`,
          },
        ]
      : [],
  );

  // Private Wi-Fi addresses, which can change and come back as a new, unassigned device.
  const privates = privateAddressDevices(inputs.devices);
  add("private_addresses", privates.length ? [{ key: "private_addresses", check: "private_addresses", details: { devices: deviceRefs(privates) }, subject: ids(privates.map((device) => device.mac)) }] : []);

  // Wi-Fi settings Sonos says break its speakers, on the Wi-Fi that carries them.
  if (inputs.wifis === null) skipped.push("wifi_multicast", "smart_home_wifi");
  else {
    const sonosNetworks = new Set(sonosWireless.map((device) => device.networkId));
    const flagged = inputs.wifis
      .filter((wifi) => wifi.enabled && sonosNetworks.has(wifi.networkId))
      .map((wifi) => ({ wifi, settings: [wifi.multicastToUnicastConversionEnabled ? "multicast_to_unicast" : null, wifi.clientIsolationEnabled ? "client_isolation" : null].filter((item): item is string => item !== null) }))
      .filter((item) => item.settings.length);
    add(
      "wifi_multicast",
      flagged.length
        ? [
            {
              key: "wifi_multicast",
              check: "wifi_multicast",
              details: { wifis: byName(flagged.map(({ wifi, settings }) => ({ id: wifi.id, name: wifi.name, settings }))) },
              subject: ids(flagged.map(({ wifi, settings }) => `${wifi.id}:${settings.join("+")}`)),
            },
          ]
        : [],
    );

    // Smart-home Wi-Fi: Things devices' Wi-Fi only on 5/6 GHz, or WPA3 only.
    const thingsNetworks = new Set(inputs.devices.filter((device) => device.groupKind === "things" && wireless(device)).map((device) => device.networkId));
    add(
      "smart_home_wifi",
      inputs.wifis
        .filter((wifi) => wifi.enabled && thingsNetworks.has(wifi.networkId))
        .map((wifi) => ({
          wifi,
          settings: [
            wifi.frequenciesGHz && !wifi.frequenciesGHz.includes(2.4) ? "no_2_4_ghz" : null,
            /^WPA3_(PERSONAL|ENTERPRISE)$/.test(wifi.security) ? "wpa3_only" : null,
          ].filter((item): item is string => item !== null),
        }))
        .filter((item) => item.settings.length)
        .map(({ wifi, settings }) => ({
          key: `smart_home_wifi:${wifi.id}`,
          check: "smart_home_wifi" as const,
          details: { wifis: [{ id: wifi.id, name: wifi.name, settings }] },
          subject: settings.join("+"),
        })),
    );
  }

  // Speakers and casting targets on one network, phones on another, and mDNS not forwarded between them.
  const phones = inputs.devices.filter(isPhone);
  const phoneNetworks = new Set(phones.map((device) => device.networkId).filter((id): id is string => id !== null));
  const mdnsBlocked = (targets: CheckupDevice[]) => {
    const across = targets.filter((device) => device.networkId !== null && !phoneNetworks.has(device.networkId) && phoneNetworks.size > 0);
    const networkIds = new Set(across.map((device) => device.networkId!));
    const off = [...networkIds, ...phoneNetworks].map((id) => networks.get(id)).filter((network): network is CheckupNetwork => network?.mdnsForwardingEnabled === false);
    return across.length && off.length ? { devices: across, off } : null;
  };
  const sonosBlocked = mdnsBlocked(sonos);
  add(
    "sonos_mdns",
    sonosBlocked
      ? [
          {
            key: "sonos_mdns",
            check: "sonos_mdns",
            details: { devices: deviceRefs(sonosBlocked.devices), networks: byName(sonosBlocked.off.map(({ id, name }) => ({ id, name }))) },
            subject: `${ids(sonosBlocked.devices.map((device) => device.mac))};${ids(sonosBlocked.off.map((network) => network.id))}`,
          },
        ]
      : [],
  );
  const castBlocked = mdnsBlocked(inputs.devices.filter((device) => isCastTarget(device) && !isSonos(device)));
  add(
    "casting_mdns",
    castBlocked
      ? [
          {
            key: "casting_mdns",
            check: "casting_mdns",
            details: { devices: deviceRefs(castBlocked.devices), networks: byName(castBlocked.off.map(({ id, name }) => ({ id, name }))) },
            subject: `${ids(castBlocked.devices.map((device) => device.mac))};${ids(castBlocked.off.map((network) => network.id))}`,
          },
        ]
      : [],
  );

  // A managed network hands out its own DNS server.
  add(
    "dns_override",
    byName(inputs.networks.filter((network) => network.managed && network.dnsServers.length)).map((network) => ({
      key: `dns_override:${network.id}`,
      check: "dns_override",
      details: { networks: [{ id: network.id, name: network.name, dnsServers: [...network.dnsServers] }] },
      subject: [...network.dnsServers].sort().join(","),
    })),
  );

  // Networks FamilyFi doesn't manage that have devices on them.
  const unmanaged = byName(inputs.networks.filter((network) => !network.managed && network.clientCount > 0));
  add(
    "unmanaged_networks",
    unmanaged.length
      ? [
          {
            key: "unmanaged_networks",
            check: "unmanaged_networks",
            details: { networks: unmanaged.map(({ id, name, clientCount }) => ({ id, name, clientCount })) },
            subject: ids(unmanaged.map((network) => network.id)),
          },
        ]
      : [],
  );

  return { findings, passed, skipped };
}

/** The managed networks whose DHCP hands out their own DNS server, by id, for the rule editor's note. */
export function outsideDnsNetworks(state: Pick<CheckupState, "findings"> | null | undefined): Map<string, { name: string; dnsServers: string[] }> {
  const map = new Map<string, { name: string; dnsServers: string[] }>();
  for (const finding of state?.findings ?? []) {
    if (finding.check !== "dns_override") continue;
    for (const network of finding.details.networks ?? []) map.set(network.id, { name: network.name, dnsServers: network.dnsServers ?? [] });
  }
  return map;
}

/**
 * The rule editor's note under Applies to: a category, app or website rule covers a group with
 * devices on a network that hands out its own DNS. FamilyFi never refuses the rule; it only says so.
 */
export function outsideDnsNote(
  rule: { kind: string; scope: string; groupIds: string[]; networkIds: string[] },
  devices: { groupId: string | null; networkId: string | null }[],
  state: Pick<CheckupState, "findings"> | null | undefined,
): string | null {
  if (rule.kind === "internet") return null;
  const outside = outsideDnsNetworks(state);
  if (!outside.size) return null;
  const covered =
    rule.scope === "network"
      ? rule.networkIds.filter((id) => outside.has(id))
      : [...new Set(devices.filter((device) => device.groupId && rule.groupIds.includes(device.groupId) && device.networkId && outside.has(device.networkId)).map((device) => device.networkId!))];
  if (!covered.length) return null;
  const networks = covered.map((id) => outside.get(id)!);
  const servers = namesList([...new Set(networks.flatMap((network) => network.dnsServers))]);
  return `Some of these devices are on ${namesList(networks.map((network) => network.name))}, which hands out ${servers} for DNS instead of the gateway. This rule only sees their lookups if that server forwards them through the gateway.`;
}

/** The open problems, which the nav badge counts. */
export function openProblemCount(findings: Pick<CheckupFinding, "kind" | "dismissed">[]): number {
  return findings.filter((finding) => finding.kind === "problem" && !finding.dismissed).length;
}

/** "Living Room", "Living Room and Kitchen", "Living Room, Kitchen and Bedroom", "… and 3 more". */
export function namesList(names: string[], shown = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= shown) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export type CheckupCopy = {
  icon: IconName;
  title: string;
  /** What FamilyFi saw. */
  seen: string;
  /** Why it matters. */
  why: string;
  /** The steps to change it, in UniFi or on the device. */
  fix: string[];
  /** A vendor's guide. */
  guide?: { label: string; href: string };
  /** A page in FamilyFi that shows it. */
  show?: { label: string; href: string };
};

/** Ubiquiti's own advice for Sonos on UniFi. */
const SONOS_GUIDE = { label: "UniFi’s Sonos guide", href: "https://help.ui.com/hc/en-us/articles/18930473041047-Best-Practices-for-Sonos-Devices" };

const WIFI_SETTING: Record<string, string> = {
  multicast_to_unicast: "Multicast to Unicast",
  client_isolation: "Client Device Isolation",
  no_2_4_ghz: "no 2.4 GHz",
  wpa3_only: "WPA3 only",
};

/** The words for a finding: what was seen, why it matters and how to change it. */
export function checkupCopy(finding: Pick<CheckupFinding, "check" | "details">): CheckupCopy {
  const devices = finding.details.devices ?? [];
  const networks = finding.details.networks ?? [];
  const wifis = finding.details.wifis ?? [];
  const names = (items: { name: string }[]) => namesList(items.map((item) => item.name));
  switch (finding.check) {
    case "sonos_mixed": {
      const wiredOnes = devices.filter((device) => device.wired);
      const wifiOnes = devices.filter((device) => !device.wired);
      return {
        icon: "speaker-high",
        title: "Sonos is both wired and on Wi-Fi",
        seen: `${names(wiredOnes)} ${wiredOnes.length === 1 ? "is" : "are"} wired. ${names(wifiOnes)} ${wifiOnes.length === 1 ? "is" : "are"} on Wi-Fi.`,
        why: "A wired Sonos starts its own wireless network for the others, which can loop with your UniFi switches and drop the whole network or make speakers vanish. Speakers on that network can also show up as wired here.",
        fix: [
          "Choose all on Wi-Fi or all wired.",
          `All on Wi-Fi: unplug ${wiredOnes.length === 1 ? `${wiredOnes[0]!.name}’s cable` : "the wired speakers’ cables"} and restart ${wiredOnes.length === 1 ? "it" : "them"}.`,
          "All wired: wire the others too, then in the Sonos app turn off Wi-Fi for each wired speaker.",
        ],
        guide: SONOS_GUIDE,
      };
    }
    case "private_addresses":
      return {
        icon: "device-mobile",
        title: `${plural(devices.length, "device uses", "devices use")} a private Wi-Fi address`,
        seen: `${names(devices)}. Their address can change, so they can come back as new, unassigned devices and lose their rules.`,
        why: "Phones, tablets and watches make up an address for each Wi-Fi network and may change it. FamilyFi knows a device by its address, so a new one is a new device.",
        fix: [`${PRIVATE_ADDRESS_COPY.iphone.label} ${PRIVATE_ADDRESS_COPY.iphone.steps}`, `${PRIVATE_ADDRESS_COPY.android.label} ${PRIVATE_ADDRESS_COPY.android.steps}`],
        show: { label: "Show on Devices", href: "/devices?private=1" },
      };
    case "wifi_multicast":
      return {
        icon: "wifi-high",
        title: "Wi-Fi settings that break Sonos",
        seen: wifis.map((wifi) => `${wifi.name}: ${(wifi.settings ?? []).map((setting) => WIFI_SETTING[setting] ?? setting).join(" and ")} on`).join(". ") + ".",
        why: "Sonos asks for both to be off: they stop speakers finding each other and your phones finding the speakers.",
        fix: [`UniFi Network → Settings → WiFi → ${wifis[0]?.name ?? "your Wi-Fi"} → Advanced → turn off Multicast to Unicast and Client Device Isolation.`],
        guide: SONOS_GUIDE,
      };
    case "sonos_mdns":
      return {
        icon: "speaker-high",
        title: "Phones may not find Sonos",
        seen: `${names(devices)} ${devices.length === 1 ? "is" : "are"} on another network from your phones, and mDNS is off for ${names(networks)}.`,
        why: "The Sonos app finds speakers with mDNS, which stays inside one network unless UniFi forwards it.",
        fix: [`UniFi Network → Settings → Networks → ${networks[0]?.name ?? "the network"} → turn on mDNS, and the same for the phones’ network.`],
        guide: SONOS_GUIDE,
      };
    case "casting_mdns":
      return {
        icon: "television",
        title: "Phones can’t see some TVs and printers",
        seen: `${names(devices)} ${devices.length === 1 ? "is" : "are"} on another network from your phones, and mDNS is off for ${names(networks)}.`,
        why: "Casting, AirPlay and printing find devices with mDNS, which stays inside one network unless UniFi forwards it. If you keep them apart on purpose, this is fine.",
        fix: [`UniFi Network → Settings → Networks → ${networks[0]?.name ?? "the network"} → turn on mDNS.`],
      };
    case "dns_override": {
      const network = networks[0];
      const servers = namesList(network?.dnsServers ?? []);
      return {
        icon: "network",
        title: `The ${network?.name ?? ""} network hands out its own DNS`,
        seen: `Devices on ${network?.name ?? "it"} are told to use ${servers} for DNS, not the gateway.`,
        why: `Category, app and website rules only see lookups that pass through the gateway. If ${servers} is a Pi-hole or AdGuard Home that forwards to the gateway, this is fine. Lock DNS would cut DNS off for these devices if that server is outside your home.`,
        fix: [`UniFi Network → Settings → Networks → ${network?.name ?? "the network"} → DHCP DNS Server → Auto.`],
      };
    }
    case "smart_home_wifi": {
      const wifi = wifis[0];
      const settings = (wifi?.settings ?? []).map((setting) => WIFI_SETTING[setting] ?? setting);
      return {
        icon: "house-line",
        title: `${wifi?.name ?? "A Wi-Fi"} may not suit smart-home devices`,
        seen: `${wifi?.name ?? "It"} carries Things devices and is ${namesList(settings)}.`,
        why: "Many plugs, bulbs and cameras can only join 2.4 GHz Wi-Fi with WPA2. If yours are already connected, this is fine.",
        fix: [`UniFi Network → Settings → WiFi → ${wifi?.name ?? "the Wi-Fi"} → turn on 2.4 GHz, or use WPA2/WPA3.`],
      };
    }
    case "unmanaged_networks":
      return {
        icon: "network",
        title: networks.length === 1 ? `${networks[0]!.name} isn’t managed by FamilyFi` : `${plural(networks.length, "network", "networks")} aren’t managed by FamilyFi`,
        seen: `${networks.map((network) => `${plural(network.clientCount ?? 0, "device", "devices")} on ${network.name}`).join(", ")} get no rules or quarantine.`,
        why: "FamilyFi only manages the networks chosen in Settings. A guest or work network is often left out on purpose.",
        fix: ["FamilyFi → Settings → UniFi → Managed networks."],
        show: { label: "Open Settings", href: "/settings" },
      };
  }
}

/** The network checkup as the server last saw it. */
export async function loadCheckup(request: ApiRequest): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>("/api/v1/checkup")).checkup;
}

/** Check now. It only reads the gateway. */
export async function runCheckupNow(request: ApiRequest): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>("/api/v1/checkup/run", { method: "POST", body: {} })).checkup;
}

/** Dismiss a finding, or say a note is intended; `false` shows it again. */
export async function setCheckupDismissed(request: ApiRequest, id: string, dismissed: boolean): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>(`/api/v1/checkup/findings/${encodeURIComponent(id)}`, { method: "PATCH", body: { dismissed } })).checkup;
}

/** The open findings by kind, and the dismissed ones, in the order the card shows them. */
export function checkupSections(state: Pick<CheckupState, "findings">) {
  const open = state.findings.filter((finding) => !finding.dismissed);
  return {
    problems: open.filter((finding) => finding.kind === "problem"),
    notes: open.filter((finding) => finding.kind === "note"),
    dismissed: state.findings.filter((finding) => finding.dismissed),
  };
}

/** "2 problems · 3 notes · checked 4 minutes ago", under the card's title. */
export function checkupSummary(state: CheckupState | null, now = new Date()): string {
  if (!state?.ranAt) return CHECKUP_COPY.network.never;
  const { problems, notes } = checkupSections(state);
  const parts = [problems.length ? plural(problems.length, "problem", "problems") : "No problems", ...(notes.length ? [plural(notes.length, "note", "notes")] : [])];
  return `${parts.join(" · ")} · checked ${checkedAgo(state.ranAt, now)}`;
}

function checkedAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute", "minutes")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${plural(hours, "hour", "hours")} ago`;
  return `${plural(Math.floor(hours / 24), "day", "days")} ago`;
}

/** The recommended protections, each a built-in rule, in the order Checkup lists them. */
export function recommendedRules(rules: Rule[]): Rule[] {
  return [QUARANTINE_RULE_ID, LOCK_DNS_RULE_ID, COUNTRIES_RULE_ID].map((id) => rules.find((rule) => rule.id === id)).filter((rule): rule is Rule => rule !== undefined);
}

/** A protection row's name. */
export function protectionTitle(rule: Pick<Rule, "builtIn">): string {
  return rule.builtIn === "quarantine" ? CHECKUP_COPY.protection.quarantine.title : rule.builtIn === "dns" ? CHECKUP_COPY.protection.dns.title : CHECKUP_COPY.protection.countries.title;
}

/** What a protection row says under its name. */
export function protectionLine(rule: Pick<Rule, "builtIn" | "countries" | "groupIds">, groups: { id: string; name: string }[]): string {
  if (rule.builtIn === "quarantine") return CHECKUP_COPY.protection.quarantine.sub;
  const names = namesList(rule.groupIds.map((id) => groups.find((group) => group.id === id)?.name ?? "Deleted group"));
  // Switched on with no group, Lock DNS covers every person and Block countries every group.
  if (rule.builtIn === "dns") return `Keeps ${rule.groupIds.length === 0 ? "every person" : names} on your gateway’s DNS`;
  const who = rule.groupIds.length === 0 || rule.groupIds.length === groups.length ? "every group" : names;
  return `Blocks ${countriesSummary(rule.countries)} for ${who}`;
}

/** Turn on every recommended protection that is off, with its default groups. Nothing it turns on is new. */
export function turnOnRecommended(mutate: HouseholdStore["mutate"], rules: Rule[]) {
  const off = recommendedRules(rules).filter((rule) => !rule.enabled);
  return mutate(
    async (send) => {
      const saved: Rule[] = [];
      for (const rule of off) saved.push((await send<{ rule: Rule }>(`/api/v1/rules/${rule.id}/on`, { method: "POST", body: {} })).rule);
      return { rules: saved };
    },
    { feedback: { notice: "Recommended protection is on. FamilyFi writes it to the gateway next." } },
  );
}

export const CHECKUP_COPY = {
  title: "Checkup",
  sub: "Recommended protection, and what on your network is worth fixing",
  protection: {
    title: "Recommended protection",
    on: (on: number, of: number) => `${on} of ${of} on`,
    turnOnAll: "Turn on all recommended",
    edit: "Edit",
    quarantine: { title: "Quarantine", sub: "New devices stay offline until you assign them" },
    dns: { title: "Lock DNS" },
    countries: { title: "Block countries" },
  },
  network: {
    title: "Network checkup",
    checkNow: "Check now",
    checking: "Checking…",
    never: "Not checked yet",
    problems: (count: number) => plural(count, "problem", "problems"),
    notes: (count: number) => `${plural(count, "note", "notes")} · may be on purpose`,
    passed: (count: number) => `${plural(count, "check", "checks")} passed`,
    dismissedCount: (count: number) => `${count} dismissed`,
    howToFix: "How to fix",
    more: "More",
    ifYouWant: "If you want to change it",
    dismiss: "Dismiss",
    intended: "This is intended",
    restore: "Show again",
    error: "The last check could not finish:",
    readOnly: "FamilyFi only reads these settings. It never changes your UniFi network for you.",
  },
  checkNames: {
    sonos_mixed: "Sonos wired and on Wi-Fi",
    private_addresses: "Private Wi-Fi addresses",
    wifi_multicast: "Wi-Fi settings for Sonos",
    sonos_mdns: "Phones can find Sonos",
    casting_mdns: "TVs and printers on other networks",
    dns_override: "Networks’ own DNS servers",
    smart_home_wifi: "Wi-Fi for smart-home devices",
    unmanaged_networks: "Networks FamilyFi doesn’t manage",
  } satisfies Record<CheckupCheck, string>,
} as const;
