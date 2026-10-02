import type { IconName } from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** A page only the web has: the API reference. */
  webOnly?: true;
};
export type NavGroup = { title: string; items: readonly NavItem[] };

/**
 * Every destination, in the groups the web's navigation lists them. The native app shows the ones
 * that are not its tabs under More, in the same groups.
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
    ],
  },
  {
    title: "System",
    items: [
      { href: "/sync", label: "Sync", icon: "arrows-clockwise" },
      { href: "/pair", label: "Pair Device", icon: "qr-code" },
      { href: "/settings", label: "Settings", icon: "gear" },
      { href: "/reference", label: "API", icon: "code", webOnly: true },
    ],
  },
];
