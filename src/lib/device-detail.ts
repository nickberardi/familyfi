/**
 * A device's detail, as every client shows it: its presence in a sentence and a colour, and its
 * Device and Connection sections row by row.
 */
import { networkLabel } from "./device-assign";
import { connectionLabel, effectivePresence, presenceLabel, type Presence } from "./device-presence";
import { deviceKindLabel } from "./display";
import { formatLogWhen } from "./sync-copy";
import type { Device, Group } from "./types";

type Network = { id: string; name: string; vlanId: number };

/** The presence pill's colours, by `--ff-*` token name: green online, amber when the check is old. */
export function presenceTone(presence: Presence): { ink: string; fill: string } {
  if (presence === "online") return { ink: "on-ink", fill: "on-tint" };
  if (presence === "stale_online" || presence === "stale_offline") return { ink: "paused", fill: "paused-fill" };
  return { ink: "muted", fill: "field" };
}

export type DeviceDetailRow = {
  label: string;
  value: string;
  /** A MAC or IP address, set in the monospaced face. */
  mono?: boolean;
  /** The row names this group and links to it. */
  group?: Pick<Group, "id" | "kind" | "name">;
};

export type DeviceDetail = {
  name: string;
  presence: Presence;
  status: string;
  /** One line under the name: how it is connected, or when it was last seen or checked. */
  summary: string;
  sections: { title: string; rows: DeviceDetailRow[] }[];
};

export function deviceDetail(device: Device, group: Group | null | undefined, networks: Network[], timezone: string, now: Date): DeviceDetail {
  const presence = effectivePresence(device, now);
  const name = device.hostname ?? "Unnamed device";
  const network = networks.find((item) => item.id === device.networkId)?.name ?? networkLabel(device, networks);
  const connection = connectionLabel(device.connectionType);
  const checked = device.presenceCheckedAt ? formatLogWhen(device.presenceCheckedAt, timezone) : "Never checked";
  const lastSeen = device.lastSeenAt ? formatLogWhen(device.lastSeenAt, timezone) : "Unknown";
  const summary =
    presence === "online"
      ? [connection, device.accessPointName, device.connectedAt ? `connected since ${formatLogWhen(device.connectedAt, timezone)}` : null]
          .filter(Boolean)
          .join(" · ") || "Connected now"
      : presence === "offline"
        ? `Last seen ${lastSeen}`
        : presence === "unknown"
          ? "No successful presence check yet"
          : `Presence checked ${checked}`;
  const connectedNow = device.connectedAt && (presence === "online" || presence === "stale_online");

  const rows = (list: (DeviceDetailRow | null)[]) => list.filter((row): row is DeviceDetailRow => row !== null);
  return {
    name,
    presence,
    status: presenceLabel(presence),
    summary,
    sections: [
      {
        title: "Device",
        rows: rows([
          group ? { label: "Group", value: group.name, group } : { label: "Group", value: "Unassigned" },
          { label: "Name", value: name },
          { label: "Device type", value: deviceKindLabel(device.hostname) },
          { label: "Manufacturer", value: device.manufacturer ?? "Unknown" },
          { label: "MAC address", value: device.mac.toUpperCase(), mono: true },
        ]),
      },
      {
        title: "Connection",
        rows: rows([
          { label: "Status", value: presenceLabel(presence) },
          { label: "Checked", value: checked },
          connectedNow
            ? { label: "Connected since", value: formatLogWhen(device.connectedAt!, timezone) }
            : { label: "Last seen", value: lastSeen },
          { label: "Connection type", value: connection ?? "Unknown" },
          device.connectionType === "wireless" ? { label: "Access point", value: device.accessPointName ?? "Unknown access point" } : null,
          { label: "Network", value: network },
          { label: "IP address", value: device.ip ?? "Unknown", mono: true },
        ]),
      },
    ],
  };
}

/** Where a group's page lives on the web, and the app's matching route. */
export function groupHref(group: Pick<Group, "id" | "kind">): string {
  return group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`;
}

/** A device's detail page; from a group's list it carries the group, so the way back returns there. */
export function deviceHref(device: Pick<Device, "mac">, fromGroupId?: string): string {
  const path = `/devices/${encodeURIComponent(device.mac)}`;
  return fromGroupId ? `${path}?from=${encodeURIComponent(fromGroupId)}` : path;
}
