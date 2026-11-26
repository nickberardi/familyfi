import { unassignedBadgeCount } from "./device-list";
import type { IconName } from "./icons";
import { familyNeedsDevices, syncFailed } from "./sync-copy";
import type { Device, SyncStatus } from "./types";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** A page only the web has: the API reference. */
  webOnly?: true;
};
export type NavGroup = { title: string; items: readonly NavItem[] };

/** FamilyFi's source, where the navigation's footer stars the project and reports an issue. */
export const SOURCE_URL = "https://github.com/nickberardi/familyfi";

/**
 * The line at the foot of the navigation, on the web's rail and the app's More and sidebar: the
 * version, then links to star the project and to report an issue on GitHub.
 */
export const NAV_FOOTER_COPY = {
  star: "Star us",
  report: "Report issue",
  reportUrl: `${SOURCE_URL}/issues/new`,
} as const;

/**
 * Every destination, in the groups the web's navigation lists them. The native app shows the ones
 * that are not its tabs under More, in the same groups, with a group of its own for the device's
 * own pages (Alerts, Watch, Connection…) between Pairing and System.
 */
export const NAV: readonly NavGroup[] = [
  {
    title: "Household",
    items: [
      { href: "/family", label: "Family", icon: "users-three" },
      { href: "/things", label: "Things", icon: "house-line" },
    ],
  },
  {
    title: "Network",
    items: [
      { href: "/devices", label: "Devices", icon: "device-mobile" },
      { href: "/rules", label: "Rules", icon: "list-checks" },
      { href: "/categories", label: "Categories", icon: "squares-four" },
      { href: "/checkup", label: "Checkup", icon: "shield-check" },
    ],
  },
  {
    title: "Pairing",
    items: [
      { href: "/pair", label: "Pair Device", icon: "qr-code" },
      { href: "/pair-me", label: "Pair FamilyFi Me", icon: "user-plus" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/sync", label: "Sync", icon: "arrows-clockwise" },
      { href: "/settings", label: "Settings", icon: "gear" },
      { href: "/diagnostics", label: "Diagnostics", icon: "gauge" },
      { href: "/reference", label: "API", icon: "code", webOnly: true },
    ],
  },
];

/** What the navigation counts beside its destinations. */
export type NavCounts = {
  /** Unassigned devices on a managed network. */
  unassignedCount: number;
  /** Family members whose rules wait for a device. */
  familyNeedsDevices: number;
  syncFailed: boolean;
  /** Open problems the network checkup found. */
  checkupProblems: number;
};

export function navCounts(
  devices: Pick<Device, "assignment" | "inScope">[],
  sync: Pick<SyncStatus, "lastRun" | "connectionStatus" | "failingCount" | "issues" | "checkupProblems"> | null | undefined,
): NavCounts {
  return {
    unassignedCount: unassignedBadgeCount(devices),
    familyNeedsDevices: familyNeedsDevices(sync),
    syncFailed: syncFailed(sync),
    checkupProblems: sync?.checkupProblems ?? 0,
  };
}

/** The count beside a destination: devices waiting, family members without a device, Checkup's open problems, a failed sync. */
export function navBadge(href: string, counts: NavCounts): number {
  if (href === "/devices") return counts.unassignedCount;
  if (href === "/family") return counts.familyNeedsDevices;
  if (href === "/checkup") return counts.checkupProblems;
  return href === "/sync" && counts.syncFailed ? 1 : 0;
}

/** A badge's tone: a family member without a device and Checkup's problems are never urgent. */
export function navBadgeTone(href: string): "paused" | "danger" {
  return href === "/family" || href === "/checkup" ? "paused" : "danger";
}

/**
 * A group's badges as one: their total, urgent when any urgent one counts. `skip` leaves out
 * destinations badged somewhere else, as the app's Devices tab is.
 */
export function navGroupBadge(title: string, counts: NavCounts, skip: readonly string[] = []): { total: number; tone: "paused" | "danger" } {
  const items = (NAV.find((group) => group.title === title)?.items ?? []).filter((item) => !skip.includes(item.href));
  const total = items.reduce((sum, item) => sum + navBadge(item.href, counts), 0);
  const urgent = items.some((item) => navBadgeTone(item.href) === "danger" && navBadge(item.href, counts) > 0);
  return { total, tone: urgent ? "danger" : "paused" };
}
