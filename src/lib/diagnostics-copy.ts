import type { GatewayDeviceHealth, GatewayHealth } from "./types";

/** Diagnostics: how hard the gateway and FamilyFi are working, apart from the household's settings. */
export const DIAGNOSTICS_COPY = {
  title: "Diagnostics",
  sub: "How hard the gateway and FamilyFi are working",
  noGateway: "Connect a gateway in Settings to see its load.",
  gateway: "Gateway",
  yourGateway: "Your gateway",
  check: "Check now",
  checking: "Checking…",
  failed: "Could not check the gateway.",
  notReported: "The console did not report this device’s load.",
  noDevices: "The console lists no devices on this site.",
  noGatewayDevice: "The console did not say which device is the gateway.",
  cpu: "CPU",
  memory: "Memory",
  load: "Load (1/5/15 min)",
  up: "Up",
  others: "Other UniFi devices",
  requests: "FamilyFi’s requests to the gateway",
} as const;

/** A reading the console did not give is unknown, never zero. */
function reading(value: number | null, format: (value: number) => string): string {
  return value === null ? "—" : format(value);
}

export function formatUptime(seconds: number | null): string {
  return reading(seconds, (value) => {
    const days = Math.floor(value / 86_400);
    const hours = Math.floor((value % 86_400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (days > 0) return `${days} d ${hours} h`;
    if (hours > 0) return `${hours} h ${minutes} min`;
    return `${minutes} min`;
  });
}

export function formatPercent(value: number | null): string {
  return reading(value, (v) => `${Math.round(v)}%`);
}

/** The 1, 5 and 15 minute load averages, or a dash when the console gave none of them. */
export function formatLoad(device: GatewayDeviceHealth): string {
  const load = [device.loadAverage1Min, device.loadAverage5Min, device.loadAverage15Min];
  return load.every((value) => value === null) ? "—" : load.map((value) => reading(value, (v) => v.toFixed(2))).join(" / ");
}

/** How a CPU or memory reading's bar is coloured: calm, getting busy, or close to full. */
export function loadTone(percent: number | null): "accent" | "paused" | "danger" {
  if (percent !== null && percent >= 90) return "danger";
  if (percent !== null && percent >= 75) return "paused";
  return "accent";
}

/** The gateway leads, as its own panel; every other device is listed under it. */
export function splitDevices(devices: GatewayDeviceHealth[]): { gateway: GatewayDeviceHealth | null; others: GatewayDeviceHealth[] } {
  const gateway = devices.find((device) => device.gateway) ?? null;
  return { gateway, others: devices.filter((device) => device !== gateway) };
}

/** When the readings were taken, in a few words. */
export function checkedAgo(checkedAt: string, now = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(checkedAt).getTime()) / 60_000));
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes} min ago`;
  return `checked ${Math.floor(minutes / 60)} h ago`;
}

/** FamilyFi's own requests to the console over the window, as three figures. */
export function requestFigures(requests: GatewayHealth["requests"]): { value: string; label: string }[] {
  const minutes = requests.windowSec / 60;
  return [
    { value: String(requests.total), label: requests.total === 1 ? "request" : "requests" },
    { value: (requests.total / minutes).toFixed(1), label: "a minute" },
    { value: String(requests.errors), label: "failed" },
  ];
}

export function requestWindow(requests: GatewayHealth["requests"]): string {
  return `Last ${requests.windowSec / 60} min`;
}
