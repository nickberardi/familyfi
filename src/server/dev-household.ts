/**
 * The mock household (`FAMILYFI_MODE` dev, test and demo): who lives there, their equipment, and the rules on them.
 * `dev-seed.ts` writes it to the database and `unifi/dev-mock.ts` reports its online
 * devices as UniFi clients, so the two agree on every MAC without importing each other.
 *
 * It is broad on purpose — every card, rule and device state the UI draws has a subject:
 * adults with no rules, teens sharing rules, a child on suggested schedules, a paused
 * member, a things group with an allowance, a paused rule, a group with no rules, devices
 * offline and unassigned. The browser specs lean on some of it: Betsy (desktop) and Abby
 * (phone) are the groups they edit, Betsy holds no category rule, and TV is the things
 * group they pause.
 */

export type DevNetwork = "lan" | "iot";

export type DevGroup =
  | { kind: "family"; name: string; familyRole: "adult" | "teen" | "child" }
  | { kind: "things"; name: string; monogram: string };

export const DEV_GROUPS: readonly DevGroup[] = [
  { kind: "family", name: "Nick", familyRole: "adult" },
  { kind: "family", name: "Melinda", familyRole: "adult" },
  { kind: "family", name: "Betsy", familyRole: "teen" },
  { kind: "family", name: "Abby", familyRole: "teen" },
  { kind: "family", name: "Cassie", familyRole: "child" },
  { kind: "things", name: "TV", monogram: "TV" },
  { kind: "things", name: "Computers", monogram: "PC" },
  { kind: "things", name: "Games", monogram: "GAME" },
  { kind: "things", name: "Servers", monogram: "SRV" },
];

/** The administrator login, linked to Nick's card. Melinda is an adult with no login. */
export const DEV_ADMIN = { username: "nick", displayName: "Nick", group: "Nick" } as const;

export type DevDevice = {
  mac: string;
  name: string;
  /** Group name, or null for a device left unassigned. */
  group: string | null;
  network: DevNetwork;
  type: "WIRED" | "WIRELESS";
  /** Index into the fixture access points (Upstairs AP, Living Room AP), for wireless clients. */
  accessPoint?: 0 | 1;
  /** Reported by the mock gateway as connected now. */
  online: boolean;
};

const device = (n: number, rest: Omit<DevDevice, "mac">): DevDevice => ({
  mac: `02:00:00:00:01:${n.toString(16).padStart(2, "0")}`,
  ...rest,
});

export const DEV_DEVICES: readonly DevDevice[] = [
  device(1, { name: "Nick's iPhone", group: "Nick", network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(2, { name: "Nick's MacBook Pro", group: "Nick", network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(3, { name: "Nick's Apple Watch", group: "Nick", network: "lan", type: "WIRELESS", online: false }),
  device(4, { name: "Melinda's iPhone", group: "Melinda", network: "lan", type: "WIRELESS", accessPoint: 1, online: true }),
  device(5, { name: "Melinda's iPad", group: "Melinda", network: "lan", type: "WIRELESS", online: false }),
  device(6, { name: "Betsy's iPhone", group: "Betsy", network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(7, { name: "Betsy's MacBook Air", group: "Betsy", network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(8, { name: "Abby's iPhone", group: "Abby", network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(9, { name: "Abby's iPad", group: "Abby", network: "lan", type: "WIRELESS", online: false }),
  device(10, { name: "Cassie's iPad", group: "Cassie", network: "lan", type: "WIRELESS", accessPoint: 1, online: true }),
  device(11, { name: "Cassie's Kindle", group: "Cassie", network: "lan", type: "WIRELESS", online: false }),
  device(12, { name: "Living Room Apple TV", group: "TV", network: "iot", type: "WIRED", online: true }),
  device(13, { name: "Bedroom Roku", group: "TV", network: "iot", type: "WIRELESS", accessPoint: 0, online: true }),
  device(14, { name: "Family iMac", group: "Computers", network: "lan", type: "WIRED", online: true }),
  device(15, { name: "Office PC", group: "Computers", network: "lan", type: "WIRED", online: true }),
  device(16, { name: "Xbox Series X", group: "Games", network: "iot", type: "WIRED", online: true }),
  device(17, { name: "PlayStation 5", group: "Games", network: "iot", type: "WIRED", online: false }),
  device(18, { name: "Nintendo Switch", group: "Games", network: "iot", type: "WIRELESS", accessPoint: 1, online: true }),
  device(19, { name: "Synology NAS", group: "Servers", network: "lan", type: "WIRED", online: true }),
  device(20, { name: "Raspberry Pi", group: "Servers", network: "lan", type: "WIRED", online: true }),
  device(21, { name: "Home Assistant", group: "Servers", network: "iot", type: "WIRED", online: true }),
  // Unassigned, so the Devices quarantine banner and its counts have subjects.
  device(22, { name: "Guest Laptop", group: null, network: "lan", type: "WIRELESS", accessPoint: 1, online: true }),
  device(23, { name: "Galaxy S24", group: null, network: "lan", type: "WIRELESS", accessPoint: 0, online: true }),
  device(24, { name: "Echo Dot", group: null, network: "iot", type: "WIRELESS", accessPoint: 1, online: true }),
];

/** An address on the device's network, unique per device. */
export function devDeviceIp(item: DevDevice): string {
  const host = 20 + DEV_DEVICES.indexOf(item);
  return item.network === "lan" ? `192.0.2.${host}` : `198.51.100.${host}`;
}

/**
 * Apps for the mock DPI catalog beside the fixture's, so an app rule reads like one.
 * The ids are made up; nothing outside the mock sends them anywhere.
 */
export const DEV_APPS = [
  { id: 20001, name: "YouTube" },
  { id: 20002, name: "Roblox" },
  { id: 20003, name: "TikTok" },
  { id: 20004, name: "Fortnite" },
  { id: 20005, name: "Discord" },
  { id: 20006, name: "Netflix" },
] as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const SCHOOL_DAYS = [1, 2, 3, 4, 5];
const SCHOOL_NIGHTS = [0, 1, 2, 3, 4];

export type DevRule = {
  name: string;
  kind: "internet" | "category" | "app" | "domain";
  groups: string[];
  windows?: { name: string; days: number[]; start: string; end: string }[];
  targetIds?: number[];
  domains?: string[];
};

/**
 * One rule of every shape the Rules page and the cards draw: internet windows (two for the
 * child, one shared by both teens, two in one rule for the TV), category schedules, an
 * always-on category, an app rule, a shared website rule, and groups with no rule at all.
 */
export const DEV_RULES: readonly DevRule[] = [
  { name: "Bedtime", kind: "internet", groups: ["Cassie"], windows: [{ name: "Bedtime", days: EVERY_DAY, start: "20:00", end: "07:00" }] },
  { name: "Homework", kind: "internet", groups: ["Cassie"], windows: [{ name: "Homework", days: SCHOOL_DAYS, start: "15:30", end: "17:30" }] },
  { name: "Kid apps", kind: "app", groups: ["Cassie"], targetIds: [20001, 20002, 20003] },
  { name: "School nights", kind: "internet", groups: ["Betsy", "Abby"], windows: [{ name: "", days: SCHOOL_NIGHTS, start: "22:30", end: "07:00" }] },
  { name: "No TikTok", kind: "domain", groups: ["Betsy", "Abby"], domains: ["tiktok.com", "tiktokcdn.com"] },
  { name: "Late gaming", kind: "category", groups: ["Abby"], targetIds: [8], windows: [{ name: "Late", days: EVERY_DAY, start: "21:00", end: "23:00" }] },
  {
    name: "TV downtime",
    kind: "internet",
    groups: ["TV"],
    windows: [
      { name: "Dinner", days: EVERY_DAY, start: "18:00", end: "20:00" },
      { name: "Overnight", days: EVERY_DAY, start: "23:00", end: "07:00" },
    ],
  },
  {
    name: "TV video evenings",
    kind: "category",
    groups: ["TV"],
    targetIds: [4],
    windows: [
      { name: "After school", days: SCHOOL_DAYS, start: "16:00", end: "18:00" },
      { name: "Late", days: EVERY_DAY, start: "21:00", end: "23:00" },
    ],
  },
  {
    name: "Gaming hours",
    kind: "internet",
    groups: ["Games"],
    windows: [
      { name: "School day", days: SCHOOL_DAYS, start: "07:30", end: "15:30" },
      { name: "Overnight", days: EVERY_DAY, start: "22:00", end: "07:00" },
    ],
  },
  { name: "Adult content", kind: "category", groups: ["Computers"], targetIds: [22] },
  { name: "Focus hours", kind: "category", groups: ["Computers"], targetIds: [24], windows: [{ name: "Work", days: SCHOOL_DAYS, start: "09:00", end: "17:00" }] },
];

/**
 * What is happening right now, so each live state has a subject: Cassie is paused, Games
 * has an allowance on its internet rule, and Focus hours is paused for everyone. Each is
 * started by Nick and ends this long after the seed runs.
 */
export const DEV_LIVE_STATES = {
  pausedGroup: { group: "Cassie", forMs: 2 * 60 * 60 * 1000 },
  allowance: { group: "Games", rule: "Gaming hours", forMs: 90 * 60 * 1000 },
  pausedRule: { rule: "Focus hours", forMs: 45 * 60 * 1000 },
  by: "Nick",
} as const;

/** The household's category resolver: Cloudflare for Families, which filters malware and adult content. */
export const DEV_DOH_URL = "https://family.cloudflare-dns.com/dns-query";

export type DevVerdict = { slug: string; verdict: "blocked" | "partial" | "open"; blockedCount?: number };

/**
 * What a check through Cloudflare for Families reports, so every category's mark has a
 * verdict: Adult blocked, some of Dating, the rest open. Video is deliberately left
 * unmeasured, because "we never looked" has to stay visibly distinct from "we looked and
 * it is clear" — that is the pair most likely to regress, and collapsing it is exactly the
 * false assurance to avoid.
 */
export const DEV_UPSTREAM_VERDICTS: readonly DevVerdict[] = [
  { slug: "adult", verdict: "blocked" },
  { slug: "dating", verdict: "partial", blockedCount: 3 },
  { slug: "social", verdict: "open" },
  { slug: "gaming", verdict: "open" },
  { slug: "vpn", verdict: "open" },
  { slug: "ai", verdict: "open" },
  { slug: "gambling", verdict: "open" },
  { slug: "messaging", verdict: "open" },
];
