import { formatLogWhen } from "./sync-copy";
import type { Device } from "./types";

export type Presence = Device["presence"];

export function effectivePresence(device: Pick<Device, "presence" | "presenceCheckedAt">, now: Date): Presence {
  if (device.presence === "unknown" || !device.presenceCheckedAt) return "unknown";
  const checked = Date.parse(device.presenceCheckedAt);
  if (Number.isNaN(checked)) return "unknown";
  if (now.getTime() - checked <= 90_000) return device.presence;
  if (device.presence === "online" || device.presence === "stale_online") return "stale_online";
  return "stale_offline";
}

export function presenceLabel(presence: Presence): string {
  if (presence === "online") return "Online";
  if (presence === "offline") return "Offline";
  if (presence === "stale_online") return "Last known online";
  if (presence === "stale_offline") return "Last known offline";
  return "Status unknown";
}

export function connectionLabel(type: Device["connectionType"]): string | null {
  if (type === "wired") return "Wired";
  if (type === "wireless") return "Wireless";
  if (type === "vpn") return "VPN";
  if (type === "teleport") return "Teleport";
  return null;
}

export function presenceSummary(device: Device, timezone: string, now: Date): string {
  const presence = effectivePresence(device, now);
  const where = device.accessPointName ?? connectionLabel(device.connectionType);
  if (presence === "unknown") return "Status unknown";
  if (presence === "offline") {
    return device.lastSeenAt ? `Offline · last seen ${formatLogWhen(device.lastSeenAt, timezone)}` : "Offline";
  }
  if (presence === "stale_offline") {
    return `Last known offline · checked ${formatLogWhen(device.presenceCheckedAt!, timezone)}`;
  }
  if (presence === "stale_online") {
    return `Last known online${where ? ` · ${where}` : ""} · checked ${formatLogWhen(device.presenceCheckedAt!, timezone)}`;
  }
  return `Online${where ? ` · ${where}` : ""}${device.connectedAt ? ` · since ${formatLogWhen(device.connectedAt, timezone)}` : ""}`;
}
