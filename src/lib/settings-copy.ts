import type { Account, Group, UnifiSettings } from "./types";
import { consoleHostFromBaseUrl } from "./unifi-host";

export function managedNetworksLabel(unifi: UnifiSettings): string {
  if (unifi.manageAllNetworks) return "All site networks";
  const selected = unifi.networks.filter((network) => unifi.managedNetworkIds.includes(network.id));
  if (selected.length === 0) return "None — discovery watches no VLANs";
  return selected.map((network) => network.name).join(", ");
}

export function gatewayFacts(unifi: UnifiSettings | null): { k: string; v: string }[] {
  if (!unifi?.configured) {
    return [
      { k: "Console", v: "Not configured" },
      { k: "Host", v: "—" },
      { k: "Site", v: "—" },
      { k: "Networks", v: "—" },
    ];
  }
  const host =
    unifi.mode === "cloud"
      ? unifi.consoleId || "—"
      : consoleHostFromBaseUrl(unifi.baseUrl) || unifi.baseUrl || "—";
  return [
    { k: "Console", v: unifi.mode === "cloud" ? "Cloud" : "Local" },
    { k: unifi.mode === "cloud" ? "Console ID" : "Host", v: host },
    { k: "Site", v: unifi.siteId || "—" },
    { k: "Networks", v: managedNetworksLabel(unifi) },
    { k: "TLS", v: unifi.tlsInsecure ? "Allow self-signed" : "Verify certificates" },
    { k: "Status", v: connectionStatusLabel(unifi.connectionStatus) },
  ];
}

export function connectionStatusLabel(status: string): string {
  if (status === "connected") return "Connected";
  if (status === "error") return "Error";
  if (status === "unconfigured") return "Not configured";
  return status;
}

export function keyState(unifi: UnifiSettings | null): { label: string; bg: string; ink: string } {
  if (!unifi?.configured) {
    return { label: "Missing", bg: "var(--ff-field-strong)", ink: "var(--ff-muted)" };
  }
  if (unifi.connectionStatus === "error") {
    return { label: "Failed", bg: "var(--ff-danger-tint)", ink: "var(--ff-danger)" };
  }
  return { label: "Working", bg: "var(--ff-on-tint)", ink: "var(--ff-on)" };
}

export function householdMemberNote(group: Pick<Group, "familyRole" | "deviceCount">, account?: Account): string {
  const devices = `${group.deviceCount} ${group.deviceCount === 1 ? "device" : "devices"}`;
  if (group.familyRole === "adult") {
    if (account?.isAdmin) return `Adult · admin · login ${account.username} · ${devices}`;
    if (account) return `Adult · login ${account.username} · no admin · ${devices}`;
    return `Adult · no FamilyFi login · ${devices}`;
  }
  if (group.familyRole === "teen") return `Teen · pause and schedule · ${devices}`;
  if (group.familyRole === "child") return `Child · pause and bedtime · ${devices}`;
  return devices;
}

export function usernameFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
}
