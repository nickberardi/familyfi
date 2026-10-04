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
    // Only administrators use FamilyFi: a login without it cannot sign in.
    if (account) return `Adult · login ${account.username} · not an admin, can't sign in · ${devices}`;
    return `Adult · no FamilyFi login · ${devices}`;
  }
  if (group.familyRole === "teen") return `Teen · pause and schedule · ${devices}`;
  if (group.familyRole === "child") return `Child · pause and bedtime · ${devices}`;
  return devices;
}

export function usernameFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
}

/** The time zones the timezone field suggests; any IANA zone can be typed. */
export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Europe/Paris",
  "UTC",
] as const;

export const FAMILY_ROLE_CHOICES = ["child", "teen", "adult"] as const;

/** The Settings page's words. */
export const SETTINGS_COPY = {
  title: "Settings",
  sub: "Gateway connection, credentials, and household roles.",
  gateway: "Gateway",
  timezone: "Timezone",
  saveTimezone: "Save timezone",
  editConnection: "Edit connection",
  /** Where a client that cannot change the gateway sends the household instead. */
  gatewayOnWeb: "Manage the gateway connection and networks in FamilyFi’s web Settings.",
  key: "UniFi API key",
  noKey: "No key saved",
  keyIssuer:
    "FamilyFi can’t issue or rotate this key — only a UniFi console admin can. Create one in your UniFi console, then paste it here. Revoking the old key in UniFi is what actually retires it.",
  keyIssuerElsewhere:
    "FamilyFi can’t issue or rotate this key — only a UniFi console admin can. Replace it in FamilyFi’s web Settings. Revoking the old key in UniFi is what actually retires it.",
  keyStored: "Stored encrypted · every UniFi call is made server-side, never from this browser.",
  keyStoredPhone: "Stored encrypted · every UniFi call is made server-side, never from this phone.",
  household: "Household",
  householdSub: "Everyone can be paused and given schedules · adults can be admins with their own login",
  admin: "Admin",
  removeLogin: "Remove login",
  addMemberPlaceholder: "Add a family member",
  add: "Add",
  createLogin: "Create login",
  cancel: "Cancel",
  username: "Username",
  password: "Password",
  confirmPassword: "Confirm password",
  passwordPlaceholder: "At least 8 characters",
  confirmPlaceholder: "Type it again",
  loginNote: "This password unlocks FamilyFi only — the gateway keeps its own credentials.",
} as const;

/** The line under the key: why it is failing, or when it was last used. */
export function keyStatusLine(unifi: Pick<UnifiSettings, "connectionError"> | null, lastSweep: string | null, sweepAge: (iso: string) => string): string {
  if (unifi?.connectionError) return unifi.connectionError;
  if (lastSweep) return `Last sweep ${sweepAge(lastSweep)}`;
  return "Save a key to start discovery and quarantine.";
}

/** The recovery account's line in Household. */
export function recoveryNote(account: Pick<Account, "username">): string {
  return `Recovery admin · username ${account.username} · password is FAMILYFI_DEFAULT_PASSWORD on the server`;
}

export function createLoginTitle(group: Pick<Group, "name">): string {
  return `Create login for ${group.name}`;
}

/** What the new-login form says about the two passwords, and whether it can be sent. */
export function loginFormState(username: string, password: string, confirm: string) {
  const hint =
    password.length < 8 ? "At least 8 characters." : password !== confirm ? "The two passwords must match." : "Looks good — this login is only for FamilyFi.";
  const passwordsOk = password.length >= 8 && password === confirm;
  return { hint, passwordsOk, canCreate: passwordsOk && username.trim().length >= 2 };
}

/** What removing a login does, where the platform asks first. */
/** Turning an adult's admin off: they lose FamilyFi entirely, so it asks first. */
export function removeAdminConfirm(account: Pick<Account, "username">, group: Pick<Group, "name">) {
  return {
    title: "Turn off admin?",
    message: `${account.username} is signed out and can no longer sign in to FamilyFi, and the phones, Watches and agents acting as ${group.name} are removed. ${group.name} stays in the household.`,
    confirmLabel: "Turn off admin",
  };
}

export function removeLoginConfirm(account: Pick<Account, "username">, group: Pick<Group, "name">) {
  return {
    title: "Remove login?",
    message: `${account.username} can no longer sign in to FamilyFi. ${group.name} stays in the household.`,
    confirmLabel: "Remove login",
  };
}
