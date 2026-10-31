/**
 * The network checkup: what FamilyFi can see about the household's network that is worth knowing,
 * as pure checks over what sync reads, and the words every client shows for each finding. FamilyFi
 * only reads and explains; it never changes the gateway because of a finding.
 *
 * A finding is a `problem` when it is almost never intended (it counts on the nav badge) or a `note`
 * when it may be by design: a note says what FamilyFi sees and what it means for FamilyFi's rules,
 * never that it is wrong.
 */
import { waitForChange, type ApiRequest } from "./api-client";
import { countriesSummary } from "./countries";
import { groupHref } from "./device-detail";
import { deviceKindLabel } from "./display";
import { FAMILYFI_POLICY_PREFIX } from "./policy-names";
import type { HouseholdStore } from "./household-store";
import type { IconName } from "./icons";
import { ruleHref } from "./rule-list";
import type { UpdateCheck } from "./types";
import { versionLabel } from "./update-copy";
import { knownUpdateTag } from "./update-track";
import { COUNTRIES_RULE_ID, LOCK_DNS_RULE_ID, QUARANTINE_RULE_ID, type Rule } from "./rules";

export const CHECKUP_CHECKS = [
  "leftover_policies",
  "gateway_drift",
  "sonos_mixed",
  "private_addresses",
  "wifi_multicast",
  "sonos_mdns",
  "casting_mdns",
  "dns_override",
  "smart_home_wifi",
  "unmanaged_networks",
  "update_tag",
  "update_available",
] as const;
export type CheckupCheck = (typeof CHECKUP_CHECKS)[number];
export type CheckupKind = "problem" | "note";

export const CHECK_KIND: Record<CheckupCheck, CheckupKind> = {
  leftover_policies: "problem",
  gateway_drift: "note",
  sonos_mixed: "note",
  private_addresses: "problem",
  wifi_multicast: "problem",
  sonos_mdns: "problem",
  casting_mdns: "note",
  dns_override: "note",
  smart_home_wifi: "note",
  unmanaged_networks: "note",
  update_tag: "problem",
  update_available: "problem",
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

/** What a gateway policy blocks, in a parent's words. */
export type CheckupPolicyBlocks = "internet" | "categories" | "apps" | "websites" | "countries" | "traffic";

/** A firewall policy on the gateway that FamilyFi has no record of, as the checks read it. */
export type CheckupPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  /** False for a policy that allows rather than blocks. */
  blocks: boolean;
  what: CheckupPolicyBlocks;
  /** The devices it names; null when it names a whole network or zone instead. */
  devices: number | null;
  scheduled: boolean;
  /**
   * What FamilyFi's own policy of the same name is for (a rule, Quarantine or a group), when it
   * has one: this is an old copy FamilyFi lost track of. Left out otherwise.
   */
  copyOf?: string;
};

/** One thing someone changed on a FamilyFi policy in the UniFi console. */
export type CheckupDriftChange =
  | { field: "switch"; familyfi: boolean; gateway: boolean }
  /** The devices it blocks, by name. */
  | { field: "devices"; familyfi: string[]; gateway: string[] }
  | { field: "schedule"; familyfi: "always" | "scheduled"; gateway: "always" | "scheduled" | "different" }
  | { field: "name"; familyfi: string; gateway: string }
  /** Anything else: what it blocks, or how. */
  | { field: "other" };

/** A rule whose policy someone changed in the UniFi console, and what they changed. */
export type CheckupDrift = {
  rule: CheckupRef;
  /** The group whose pause the rule is, for a group's pause. */
  group?: CheckupRef & { kind: "family" | "things" };
  changes: CheckupDriftChange[];
  /** When sync last found it changed. */
  seenAt: string;
  /** Whether FamilyFi has put its own version back; false while writing it back fails. */
  putBack: boolean;
};

const DRIFT_FIELDS: CheckupDriftChange["field"][] = ["switch", "devices", "schedule", "name", "other"];

/** One finding per rule: its policies' changes together, the latest time, and put back only when all are. */
export function driftByRule(drifts: CheckupDrift[]): CheckupDrift[] {
  const byRule = new Map<string, CheckupDrift>();
  for (const drift of drifts) {
    const seen = byRule.get(drift.rule.id);
    if (!seen) {
      byRule.set(drift.rule.id, { ...drift, changes: [...drift.changes] });
      continue;
    }
    for (const change of drift.changes) {
      const index = seen.changes.findIndex((item) => item.field === change.field);
      if (index < 0) seen.changes.push(change);
      else if (change.field === "devices") {
        const known = seen.changes[index] as Extract<CheckupDriftChange, { field: "devices" }>;
        const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
        seen.changes[index] = { field: "devices", familyfi: union(known.familyfi, change.familyfi), gateway: union(known.gateway, change.gateway) };
      }
    }
    if (drift.seenAt > seen.seenAt) seen.seenAt = drift.seenAt;
    seen.putBack &&= drift.putBack;
  }
  return [...byRule.values()]
    .map((drift) => ({ ...drift, changes: drift.changes.sort((a, b) => DRIFT_FIELDS.indexOf(a.field) - DRIFT_FIELDS.indexOf(b.field)) }))
    .sort((a, b) => a.rule.name.localeCompare(b.rule.name));
}

export type CheckupInputs = {
  devices: CheckupDevice[];
  networks: CheckupNetwork[];
  /** Null when the Wi-Fi networks could not be read, so the Wi-Fi checks did not run. */
  wifis: CheckupWifi[] | null;
  /**
   * The gateway's own policies that no FamilyFi record claims, administrators' included; null when
   * the policies could not be read. Only those named with FamilyFi's prefix are leftovers.
   */
  unrecordedPolicies: CheckupPolicy[] | null;
  /** FamilyFi's own policies someone changed in the UniFi console, one entry per policy. */
  drift: CheckupDrift[];
  /** `FAMILYFI_UPDATE_TAG`, the tag this install runs and takes updates from. */
  updateTag?: string;
};

export type CheckupRef = { id: string; name: string };

/** What a finding is about. Devices are named by `mac`; networks and Wi-Fi by id. */
export type CheckupDetails = {
  devices?: { mac: string; name: string; wired?: boolean }[];
  networks?: (CheckupRef & { dnsServers?: string[]; clientCount?: number })[];
  wifis?: (CheckupRef & { settings: string[] })[];
  policies?: CheckupPolicy[];
  drift?: CheckupDrift;
  /** The `FAMILYFI_UPDATE_TAG` FamilyFi does not know, for `update_tag`. */
  updateTag?: string;
  /** The release running and the newer one on offer, for `update_available`. */
  currentVersion?: string;
  latestVersion?: string;
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

/**
 * What a finding says, as a key a client looks up in its own (localized) copy, and a short English
 * line for a client that has no copy for the key. A new check thereby reaches every app version.
 */
export type CheckupMessage = { key: string; text: string };

/** A finding as `GET /checkup` returns it. */
export type CheckupFinding = {
  id: string;
  check: CheckupCheck;
  kind: CheckupKind;
  details: CheckupDetails;
  message: CheckupMessage;
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
  hideFix: "Hide",
  iphone: { label: "iPhone and iPad:", steps: "Settings → Wi-Fi → (i) next to this network → Private Wi-Fi Address → Off." },
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

  // Policies named like FamilyFi's that no rule of this household's uses: left by an earlier setup.
  if (inputs.unrecordedPolicies === null) skipped.push("leftover_policies");
  else {
    const leftovers = leftoverPolicies(inputs.unrecordedPolicies);
    add(
      "leftover_policies",
      leftovers.length ? [{ key: "leftover_policies", check: "leftover_policies", details: { policies: leftovers }, subject: ids(leftovers.map((policy) => policy.id)) }] : [],
    );
  }

  add("gateway_drift", gatewayDriftFindings(inputs.drift));

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

  // An update tag FamilyFi doesn't know: updates follow latest until it is fixed.
  const tag = inputs.updateTag?.trim() ?? "";
  add("update_tag", knownUpdateTag(tag) ? [] : [{ key: "update_tag", check: "update_tag", details: { updateTag: tag }, subject: tag }]);

  return { findings, passed, skipped };
}

/**
 * A newer FamilyFi release, from the update check rather than a checkup run: one finding while one is
 * on offer, none when FamilyFi is up to date, and null while the check has no answer. Its subject is
 * the newer release, so dismissing it lasts until the next one.
 */
export function updateFindings(update: UpdateCheck | null | undefined): CheckupResult[] | null {
  if (update?.status !== "ok") return null;
  if (!update.available || !update.latestVersion) return [];
  const details = { currentVersion: update.currentVersion, latestVersion: update.latestVersion };
  return [{ key: "update_available", check: "update_available", details, subject: update.latestVersion }];
}

/**
 * The `gateway_drift` findings, one per rule, which sync also records on its own after every pass.
 * A new change shows again even after the last one was dismissed.
 */
export function gatewayDriftFindings(drifts: CheckupDrift[]): CheckupResult[] {
  return driftByRule(drifts).map((drift) => ({ key: `gateway_drift:${drift.rule.id}`, check: "gateway_drift", details: { drift }, subject: drift.seenAt }));
}

/**
 * The unrecorded policies Checkup offers to remove: named with FamilyFi's prefix. The name only picks
 * what to show; FamilyFi deletes one only after an administrator ticks it and confirms.
 */
export function leftoverPolicies<T extends { name: string }>(policies: T[]): T[] {
  return byName(policies.filter((policy) => policy.name.startsWith(FAMILYFI_POLICY_PREFIX)));
}

const POLICY_WHAT: Record<CheckupPolicyBlocks, string> = {
  internet: "all internet",
  categories: "categories",
  apps: "apps",
  websites: "websites",
  countries: "countries",
  traffic: "some traffic",
};

/** "Blocks all internet for 4 devices, on a schedule", under a leftover policy's name. */
export function leftoverPolicyLine(policy: Pick<CheckupPolicy, "blocks" | "what" | "devices" | "scheduled">): string {
  const who = policy.devices === null ? "" : ` for ${plural(policy.devices, "device", "devices")}`;
  return `${policy.blocks ? "Blocks" : "Allows"} ${POLICY_WHAT[policy.what]}${who}, ${policy.scheduled ? "on a schedule" : "always"}`;
}

/** The line under a leftover that is an old copy of one of FamilyFi's own, or null. */
export function leftoverCopyNote(policy: Pick<CheckupPolicy, "copyOf" | "enabled" | "blocks">): string | null {
  if (!policy.copyOf) return null;
  const effect = !policy.enabled ? "This old one is off, so it does nothing now." : policy.blocks ? "This old one keeps blocking even when you pause or allow it." : "This old one still lets traffic through.";
  return `FamilyFi already has a newer copy of this for ${policy.copyOf}. ${effect}`;
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
 * The rule editor's note under Applies to: a website rule covers a group with devices on a network
 * that hands out its own DNS. Category and app rules match traffic, not lookups, so they get none.
 * FamilyFi never refuses the rule; it only says so.
 */
export function outsideDnsNote(
  rule: { kind: string; scope: string; groupIds: string[]; networkIds: string[] },
  devices: { groupId: string | null; networkId: string | null }[],
  state: Pick<CheckupState, "findings"> | null | undefined,
): string | null {
  if (rule.kind !== "domain") return null;
  const outside = outsideDnsNetworks(state);
  if (!outside.size) return null;
  const covered =
    rule.scope === "network"
      ? rule.networkIds.filter((id) => outside.has(id))
      : [...new Set(devices.filter((device) => device.groupId && rule.groupIds.includes(device.groupId) && device.networkId && outside.has(device.networkId)).map((device) => device.networkId!))];
  if (!covered.length) return null;
  const networks = covered.map((id) => outside.get(id)!);
  const servers = namesList([...new Set(networks.flatMap((network) => network.dnsServers))]);
  return `Some of these devices are on ${namesList(networks.map((network) => network.name))}, which uses its own DNS server (${servers}). This rule may not block websites for them.`;
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
  no_2_4_ghz: "2.4 GHz turned off",
  wpa3_only: "WPA3 only",
};

/** Whether this build knows a check. The API adds checks over time. */
export function knownCheck(check: string): check is CheckupCheck {
  return (CHECKUP_CHECKS as readonly string[]).includes(check);
}

const MESSAGE_KEY_PREFIX = "checkup.";

/** The finding's `message`: `checkup.<check>`, and its title in English. */
export function checkupMessage(finding: Pick<CheckupFinding, "check" | "details">): CheckupMessage {
  return { key: `${MESSAGE_KEY_PREFIX}${finding.check}`, text: checkupCopy(finding).title };
}

/** Whether this build has copy for a message key; when it does not, the client shows the message's `text`. */
export function knownCheckupMessage(message: Pick<CheckupMessage, "key">): boolean {
  return message.key.startsWith(MESSAGE_KEY_PREFIX) && knownCheck(message.key.slice(MESSAGE_KEY_PREFIX.length));
}

/** The words for a finding: what was seen, why it matters and how to change it. */
export function checkupCopy(finding: Pick<CheckupFinding, "check" | "details">): CheckupCopy {
  const devices = finding.details.devices ?? [];
  const networks = finding.details.networks ?? [];
  const wifis = finding.details.wifis ?? [];
  const names = (items: { name: string }[]) => namesList(items.map((item) => item.name));
  switch (finding.check) {
    case "leftover_policies": {
      const policies = finding.details.policies ?? [];
      const one = policies.length === 1;
      return {
        icon: "warning",
        title: one ? "An old FamilyFi policy is still on your gateway" : `${policies.length} old FamilyFi policies are still on your gateway`,
        seen: one ? "It has a FamilyFi name, but none of your rules use it." : "They have FamilyFi names, but none of your rules use them.",
        why: `${one ? "It is" : "They are"} probably left over from an earlier FamilyFi setup. FamilyFi doesn’t change ${one ? "it" : "them"} on its own, so ${one ? "if it’s on, it" : "any that are on"} can still block devices.`,
        fix: ["Tick the ones you don’t want and remove them. FamilyFi removes only the ones you tick."],
      };
    }
    case "gateway_drift": {
      const drift = finding.details.drift;
      const name = drift?.rule.name ?? "A rule";
      const href = !drift ? "/rules" : drift.group ? groupHref(drift.group) : ruleHref(drift.rule.id === QUARANTINE_RULE_ID ? { id: drift.rule.id, builtIn: "quarantine" } : drift.rule);
      return {
        icon: "arrows-clockwise",
        title: `${name} was changed in UniFi`,
        seen: drift?.putBack === false
          ? `Someone changed ${name} in the UniFi console. FamilyFi hasn’t been able to change it back yet, so your gateway is doing what UniFi says.`
          : `Someone changed ${name} in the UniFi console. FamilyFi changed it back to how you set it.`,
        why: `FamilyFi keeps its rules on your gateway the way you set them in FamilyFi, so changes made in UniFi don’t last.`,
        fix: [`Change ${name} in FamilyFi instead of in UniFi.`],
        show: { label: drift?.group ? `Open ${drift.group.name}` : drift?.rule.id === QUARANTINE_RULE_ID ? "Open Devices" : `Edit ${name}`, href },
      };
    }
    case "sonos_mixed": {
      const wiredOnes = devices.filter((device) => device.wired);
      const wifiOnes = devices.filter((device) => !device.wired);
      return {
        icon: "speaker-high",
        title: "Some Sonos speakers are wired, some on Wi-Fi",
        seen: `${names(wiredOnes)} ${wiredOnes.length === 1 ? "is" : "are"} wired. ${names(wifiOnes)} ${wifiOnes.length === 1 ? "is" : "are"} on Wi-Fi.`,
        why: "This is usually fine. Sometimes a wired Sonos makes the network loop, which can drop speakers or knock out the internet for everyone. Older speakers like the Play:1 and IKEA Symfonisk are the most likely to cause it. If your speakers and internet work fine, you can ignore this.",
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
        seen: `${names(devices)}.`,
        why: "Phones, tablets and watches can change their Wi-Fi address. When one does, FamilyFi sees a new device, and it loses its rules until you assign it again.",
        fix: [`${PRIVATE_ADDRESS_COPY.iphone.label} ${PRIVATE_ADDRESS_COPY.iphone.steps}`, `${PRIVATE_ADDRESS_COPY.android.label} ${PRIVATE_ADDRESS_COPY.android.steps}`],
        show: { label: "Show on Devices", href: "/devices?private=1" },
      };
    case "wifi_multicast":
      return {
        icon: "wifi-high",
        title: "Wi-Fi settings that can break Sonos",
        seen: wifis.map((wifi) => `${wifi.name}: ${(wifi.settings ?? []).map((setting) => WIFI_SETTING[setting] ?? setting).join(" and ")} on`).join(". ") + ".",
        why: "Sonos asks for these to be off. With them on, speakers may not group and phones may not find them.",
        fix: [`UniFi Network → Settings → WiFi → ${wifis[0]?.name ?? "your Wi-Fi"} → Advanced → turn off Multicast to Unicast and Client Device Isolation.`],
        guide: SONOS_GUIDE,
      };
    case "sonos_mdns":
      return {
        icon: "speaker-high",
        title: "Phones may not find Sonos",
        seen: `${names(devices)} ${devices.length === 1 ? "is" : "are"} on a different network from your phones.`,
        why: `The Sonos app only finds speakers on another network when mDNS is on for both networks in UniFi. It’s off for ${names(networks)}.`,
        fix: [`UniFi Network → Settings → Networks → ${networks[0]?.name ?? "the network"} → turn on mDNS. Do the same for your phones’ network.`, "If they still can’t connect, check that your firewall lets the two networks talk."],
        guide: SONOS_GUIDE,
      };
    case "casting_mdns":
      return {
        icon: "television",
        title: "Phones can’t see some TVs and printers",
        seen: `${names(devices)} ${devices.length === 1 ? "is" : "are"} on a different network from your phones.`,
        why: `Phones can only cast, AirPlay or print to another network when mDNS is on for both networks in UniFi. It’s off for ${names(networks)}. If you keep them apart on purpose, you can ignore this.`,
        fix: [`UniFi Network → Settings → Networks → ${networks[0]?.name ?? "the network"} → turn on mDNS.`, "If they still can’t connect, check that your firewall lets the two networks talk."],
      };
    case "dns_override": {
      const network = networks[0];
      const servers = namesList(network?.dnsServers ?? []);
      return {
        icon: "network",
        title: `The ${network?.name ?? ""} network uses its own DNS server`,
        seen: `Devices on ${network?.name ?? "it"} look up websites through ${servers} instead of your gateway.`,
        why: `Category and app rules still work. Website rules might not, because your gateway doesn’t see those lookups. If ${servers} is a Pi-hole or AdGuard Home, you can ignore this.`,
        fix: [`UniFi Network → Settings → Networks → ${network?.name ?? "the network"} → DHCP DNS Server → Auto.`],
      };
    }
    case "smart_home_wifi": {
      const wifi = wifis[0];
      const settings = (wifi?.settings ?? []).map((setting) => WIFI_SETTING[setting] ?? setting);
      return {
        icon: "house-line",
        title: `${wifi?.name ?? "A Wi-Fi"} may not work for smart-home devices`,
        seen: `${wifi?.name ?? "It"} has Things devices on it, with ${namesList(settings)}.`,
        why: "Many plugs, bulbs and cameras only connect to 2.4 GHz Wi-Fi using WPA2. If yours are already connected, you can ignore this.",
        fix: [`UniFi Network → Settings → WiFi → ${wifi?.name ?? "the Wi-Fi"} → turn on 2.4 GHz, or use WPA2/WPA3.`],
      };
    }
    case "unmanaged_networks":
      return {
        icon: "network",
        title: networks.length === 1 ? `${networks[0]!.name} isn’t managed by FamilyFi` : `${plural(networks.length, "network", "networks")} aren’t managed by FamilyFi`,
        seen: `${networks.map((network) => `${plural(network.clientCount ?? 0, "device", "devices")} on ${network.name}`).join(", ")} get no rules or quarantine.`,
        why: "FamilyFi only looks after the networks you pick in Settings. Guest and work networks are often left out on purpose.",
        fix: ["FamilyFi → Settings → Gateway → Edit connection → pick the networks → Save network selection."],
        show: { label: "Open Settings", href: "/settings?tab=gateway" },
      };
    case "update_tag":
      return {
        icon: "warning",
        title: "FamilyFi can’t follow your update setting",
        seen: `FAMILYFI_UPDATE_TAG is “${finding.details.updateTag ?? ""}”, which isn’t latest, next or a version such as 0.38.`,
        why: "Updates won’t install until it’s fixed. It’s probably a typo, or left over from going back to an earlier release.",
        fix: [
          "In the .env file next to docker-compose.yml, set FAMILYFI_UPDATE_TAG to latest, next, or a version such as 0.38, or remove the line to use latest.",
          "Then run docker compose up -d in that folder.",
        ],
      };
    case "update_available": {
      const latest = versionLabel(finding.details.latestVersion ?? "");
      return {
        icon: "arrows-clockwise",
        title: `FamilyFi ${latest} is ready`,
        seen: `You’re on ${versionLabel(finding.details.currentVersion ?? "")}.`,
        why: "New versions fix problems and add features. Your rules keep working while it installs.",
        fix: ["FamilyFi → Settings → Maintenance → read what’s new → Install."],
        show: { label: "Update", href: "/settings?tab=maintenance" },
      };
    }
  }
}

/**
 * The rows of a changed-in-UniFi note: what FamilyFi has, and what was on the gateway. Short lists
 * are named in full; longer ones name only the devices that differ. A field newer than this build
 * has no row.
 */
export function driftRows(drift: Pick<CheckupDrift, "changes">): { label: string; familyfi: string; gateway: string }[] {
  const text = CHECKUP_COPY.network.drift;
  return drift.changes.filter((change) => DRIFT_FIELDS.includes(change.field)).map((change) => {
    switch (change.field) {
      case "switch":
        return { label: text.switch, familyfi: change.familyfi ? text.on : text.off, gateway: change.gateway ? text.on : text.off };
      case "devices": {
        const list = (names: string[]) => (names.length ? namesList(names) : text.noDevices);
        if (change.familyfi.length <= 3 && change.gateway.length <= 3) return { label: text.devices, familyfi: list(change.familyfi), gateway: list(change.gateway) };
        const missing = change.familyfi.filter((name) => !change.gateway.includes(name));
        const extra = change.gateway.filter((name) => !change.familyfi.includes(name));
        const side = (included: string[], left: string[]) =>
          [included.length ? text.with(namesList(included)) : null, left.length ? text.without(namesList(left)) : null].filter(Boolean).join("; ");
        return { label: text.devices, familyfi: side(missing, extra), gateway: side(extra, missing) };
      }
      case "schedule":
        return { label: text.schedule, familyfi: text.schedules[change.familyfi] ?? text.changed, gateway: text.schedules[change.gateway] ?? text.changed };
      case "name":
        return { label: text.name, familyfi: change.familyfi, gateway: change.gateway };
      case "other":
        return { label: text.other, familyfi: text.asSet, gateway: text.changed };
    }
  });
}

/** The network checkup as the server last saw it. */
export async function loadCheckup(request: ApiRequest): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>("/api/v1/checkup")).checkup;
}

/** Check now. It only reads the gateway. */
export async function runCheckupNow(request: ApiRequest): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>("/api/v1/checkup/run", { method: "POST", body: {} })).checkup;
}

/**
 * Put it back: a sync pass now, waited for, then the checkup as that pass left it and what to tell
 * the administrator. The pass writes back every rule changed in UniFi, not only the one pressed.
 */
export async function putBackNow(request: ApiRequest): Promise<{ checkup: CheckupState; notice: string }> {
  const { change } = await request<{ change: { changeId: string } }>("/api/v1/sync/retry", { method: "POST", body: {} });
  const outcome = await waitForChange(request, change.changeId);
  const checkup = await loadCheckup(request);
  const failing = checkup.findings.some((finding) => finding.check === "gateway_drift" && finding.details.drift?.putBack === false);
  const text = CHECKUP_COPY.network.drift;
  return { checkup, notice: outcome.status === "pending" ? text.stillPutting : failing ? text.putBackFailed : text.putBackDone };
}

/** Dismiss a finding, or say a note is intended; `false` shows it again. */
export async function setCheckupDismissed(request: ApiRequest, id: string, dismissed: boolean): Promise<CheckupState> {
  return (await request<{ checkup: CheckupState }>(`/api/v1/checkup/findings/${encodeURIComponent(id)}`, { method: "PATCH", body: { dismissed } })).checkup;
}

export type LeftoverRemoval = {
  checkup: CheckupState;
  /** The policies deleted from the gateway. */
  removed: string[];
  /** The policies left alone: gone already, renamed, or now one of FamilyFi's own. */
  skipped: string[];
  /** The policies the gateway would not delete. */
  failed: string[];
};

/** What a removal did, in one line for the page to show: removed, then left alone, then failed. */
export function leftoverRemovalNotice(result: Pick<LeftoverRemoval, "removed" | "skipped" | "failed">): string {
  const text = CHECKUP_COPY.network.leftover;
  return [
    result.removed.length ? text.removed(result.removed.length) : "",
    result.skipped.length ? text.skipped(result.skipped.length) : "",
    result.failed.length ? text.failed(result.failed.length) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Remove leftover FamilyFi policies the administrator ticked and confirmed. */
export async function removeLeftoverPolicies(request: ApiRequest, policyIds: string[]): Promise<LeftoverRemoval> {
  return request<LeftoverRemoval>("/api/v1/checkup/leftover-policies/remove", { method: "POST", body: { policyIds } });
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
export function protectionLine(
  rule: Pick<Rule, "builtIn" | "countries" | "scope" | "groupIds" | "networkIds">,
  groups: { id: string; name: string }[],
  networks: { id: string; name: string }[] = [],
): string {
  if (rule.builtIn === "quarantine") return CHECKUP_COPY.protection.quarantine.sub;
  if (rule.scope === "network") {
    const where = `everything on ${namesList((rule.networkIds ?? []).map((id) => networks.find((network) => network.id === id)?.name ?? "a network"))}`;
    return rule.builtIn === "dns" ? `Keeps ${where} off other DNS servers` : `Blocks ${countriesSummary(rule.countries ?? [])} for ${where}`;
  }
  const names = namesList((rule.groupIds ?? []).map((id) => groups.find((group) => group.id === id)?.name ?? "Deleted group"));
  // Switched on with no group, Lock DNS covers every person and Block countries every group.
  if (rule.builtIn === "dns") return `Keeps ${(rule.groupIds ?? []).length === 0 ? "every person" : names} off other DNS servers`;
  const who = (rule.groupIds ?? []).length === 0 || (rule.groupIds ?? []).length === groups.length ? "every group" : names;
  return `Blocks ${countriesSummary(rule.countries ?? [])} for ${who}`;
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
  sub: "Recommended protection, and anything worth fixing or updating",
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
    title: "Things to look at",
    checkNow: "Check now",
    checking: "Checking…",
    never: "Not checked yet",
    unknown: "Update the FamilyFi app to see more and act on this.",
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
    readOnly: "FamilyFi only reads these settings. The one thing it removes is a leftover FamilyFi policy, and only when you ask.",
    drift: {
      inFamilyFi: "In FamilyFi",
      wasOnGateway: "Was on the gateway",
      onGateway: "On the gateway",
      putBack: "Put it back",
      putBackDone: "FamilyFi changed it back on your gateway.",
      putBackFailed: "FamilyFi still couldn’t change it back. Check that your gateway is online, then try again.",
      stillPutting: "FamilyFi is still changing it back. Check again in a minute.",
      switch: "Switch",
      on: "On",
      off: "Off",
      devices: "Devices",
      noDevices: "No devices",
      with: (names: string) => `With ${names}`,
      without: (names: string) => `Without ${names}`,
      schedule: "When",
      schedules: { always: "Always", scheduled: "On a schedule", different: "A different schedule" },
      name: "Name",
      other: "What it blocks",
      asSet: "As you set it",
      changed: "Changed",
    },
    leftover: {
      remove: (count: number) => (count === 1 ? "Remove 1 from gateway" : `Remove ${count} from gateway`),
      keep: (count: number) => (count === 1 ? "Keep it" : "Keep them"),
      on: "On",
      off: "Off",
      confirmTitle: (count: number) => (count === 1 ? "Remove 1 policy from your gateway?" : `Remove ${count} policies from your gateway?`),
      confirmBody: "Devices they block get their internet back. Your FamilyFi rules don’t change. This can’t be undone.",
      confirm: (count: number) => `Remove ${count}`,
      cancel: "Cancel",
      removed: (count: number) => (count === 1 ? "Removed 1 policy from your gateway." : `Removed ${count} policies from your gateway.`),
      skipped: (count: number) => `${plural(count, "policy was", "policies were")} left alone because ${count === 1 ? "it" : "they"} changed since the last check.`,
      failed: (count: number) => `${plural(count, "policy", "policies")} could not be removed. Try again in a minute.`,
    },
  },
  checkNames: {
    leftover_policies: "Old FamilyFi policies on the gateway",
    gateway_drift: "FamilyFi’s rules not changed in UniFi",
    sonos_mixed: "Sonos wired and on Wi-Fi",
    private_addresses: "Private Wi-Fi addresses",
    wifi_multicast: "Wi-Fi settings for Sonos",
    sonos_mdns: "Phones can find Sonos",
    casting_mdns: "TVs and printers on other networks",
    dns_override: "Networks’ own DNS servers",
    smart_home_wifi: "Wi-Fi for smart-home devices",
    unmanaged_networks: "Networks FamilyFi doesn’t manage",
    update_tag: "Update setting",
    update_available: "FamilyFi is up to date",
  } satisfies Record<CheckupCheck, string>,
} as const;
