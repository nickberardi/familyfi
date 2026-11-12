import { ApiError, type ApiRequest } from "./api-client";
import type { ConnectionProfile } from "./companion-pairing";
import { isAppControls } from "./pair-device";
import { compareSemver, parseSemver } from "./semver";
import type { Group, PairedPhone } from "./types";
import { watchProvisioning, type WatchEnrollment, type WatchProvisioning } from "./watch";

/**
 * An app's controls: Siri, Shortcuts and the system's own switches run outside the app, where the
 * app's session cannot be shared safely, because two holders of one rotating refresh token end the
 * sign-in. So the app sets up one paired device for them, as it sets up a Watch: the same client
 * (`app`) with the `rulesOnly` scope, its own bearer and refresh token, and the app as its parent,
 * so unpairing or revoking the app ends it too. Each app has at most one.
 */

/** The first contract with `app:rulesOnly`. An older server refuses the enrollment. */
export const APP_CONTROLS_MIN_API = "1.1.0";

/** Whether a server, by the `apiVersion` its `/health` reports, can set an app's controls up. */
export function supportsAppControls(apiVersion: string | null | undefined): boolean {
  const server = parseSemver(apiVersion ?? "");
  return Boolean(server) && compareSemver(server!, parseSemver(APP_CONTROLS_MIN_API)!) >= 0;
}

/** Where the app runs, for the names its system calls these by. */
export type AppControlsPlatform = "apple" | "android";

const CONTROLS_NOUN: Record<AppControlsPlatform, string> = { apple: "Siri and Shortcuts", android: "Quick Settings and shortcuts" };

/** What the household's Pair Device list calls an app's controls, in its platform's own words, within the server's 80 characters. */
export function appControlsName(platform: AppControlsPlatform, deviceName: string | null | undefined): string {
  const name = deviceName?.trim();
  return (name ? `${CONTROLS_NOUN[platform]} on ${name}` : CONTROLS_NOUN[platform]).slice(0, 80);
}

/**
 * Enrolls this app's controls, in one call: the app invites and claims them. `controlsId` is an id
 * the app makes once and keeps; enrolling it again replaces the earlier record.
 */
export function enrollAppControls(request: ApiRequest, controlsId: string, platform: AppControlsPlatform, deviceName?: string | null): Promise<WatchEnrollment> {
  return request<WatchEnrollment>("/api/v1/paired/invites?claim=true", {
    method: "POST",
    body: { client: "app", scope: "rulesOnly", clientId: controlsId.toLowerCase(), displayName: appControlsName(platform, deviceName) },
  });
}

/**
 * What the app stores for its native code: the same shape a Watch is handed, so one native reader
 * serves both (`watchId` holds the controls' id). The manifest is checked first.
 */
export function appControlsProvisioning(
  controlsId: string,
  enrollment: WatchEnrollment,
  profile: Pick<ConnectionProfile, "instanceId" | "publicKeyX">,
): WatchProvisioning {
  return watchProvisioning(controlsId, enrollment, profile);
}

/** This app's controls that still work, from the devices the app may see, or null. */
export async function findAppControls(request: ApiRequest, appDeviceId: string): Promise<PairedPhone | null> {
  const { devices } = await request<{ devices: PairedPhone[] }>("/api/v1/paired/devices?client=app&status=active");
  return devices.find((device) => isAppControls(device) && device.parentDeviceId === appDeviceId) ?? null;
}

/** Where the app's controls stand: the server cannot set them up, they are being set up, or they work. */
export type AppControlsState = "unsupported" | "settingUp" | "ready";

/** The app's native side of its controls, as far as setting them up goes. */
export type AppControlsBridge = {
  /** The controls' own id, made once, which their sign-in is claimed under. */
  clientId(): Promise<string>;
  isProvisioned(): Promise<boolean>;
  /** Takes `appControlsProvisioning` as JSON. */
  provision(json: string): Promise<void>;
};

/**
 * Sets the app's controls up when they hold no sign-in: asks the server's version, claims the
 * sign-in and hands it to the native side. The app calls this after a household read, so controls
 * the household signed out are set up again. A server too old for them, or one that reports 1.1.0
 * from before they existed and so refuses the claim as invalid, reads as `unsupported`. Any other
 * failure throws, and the controls stay `settingUp` until the next try.
 */
export async function setUpAppControls(input: {
  bridge: AppControlsBridge;
  request: ApiRequest;
  profile: Pick<ConnectionProfile, "instanceId" | "publicKeyX">;
  platform: AppControlsPlatform;
  deviceName?: string | null;
}): Promise<AppControlsState> {
  const { bridge, request, profile, platform, deviceName } = input;
  if (await bridge.isProvisioned()) return "ready";
  const health = await request<{ apiVersion?: string }>("/api/v1/health");
  if (!supportsAppControls(health.apiVersion)) return "unsupported";
  const controlsId = await bridge.clientId();
  let enrollment: WatchEnrollment;
  try {
    enrollment = await enrollAppControls(request, controlsId, platform, deviceName);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.code === "invalid_request") return "unsupported";
    throw error;
  }
  await bridge.provision(JSON.stringify(appControlsProvisioning(controlsId, enrollment, profile)));
  return "ready";
}

/** The app's Siri and Shortcuts screen on iPhone and iPad: what the actions are and how to say them. */
export const SIRI_SHORTCUTS_COPY = {
  title: "Siri and Shortcuts",
  section: "Block and pause with Siri",
  intro:
    "Ask Siri to block, pause or unblock a group, or add these actions to a shortcut or automation, without opening FamilyFi. Blocking works from the lock screen. Unblocking and adding time ask you to unlock first.",
  phrasesTitle: "Things to say",
  /** Each action's example, with a group's name where `name` goes. */
  phrases: (name: string) => [
    `"Block ${name} in FamilyFi"`,
    `"Pause ${name} in FamilyFi"`,
    `"Unblock ${name} in FamilyFi"`,
    `"Give ${name} more time in FamilyFi"`,
    `"Is ${name} blocked in FamilyFi?"`,
  ],
  /** The name in the examples when the household has no group yet. */
  anyGroup: "a group",
  open: "Open Shortcuts",
  /** The server is older than the first contract with a sign-in for the actions. */
  needsUpdate: "To use Siri and Shortcuts, update your FamilyFi server from Settings on your computer.",
  /** The actions are not signed in yet: the app does that once it has read the household. */
  settingUp: "Setting up Siri and Shortcuts…",
} as const;

/** How many shortcuts Android shows when the app's icon is pressed and held. */
export const GROUP_SHORTCUTS_MAX = 4;

/** One group's shortcut on Android: its words, and the app link it opens (the group's Block sheet). */
export type GroupShortcut = { id: string; shortLabel: string; longLabel: string; url: string };

/** A group's shortcut. `scheme` is the app's own link scheme, which differs between its builds. */
export function groupShortcut(group: Pick<Group, "id" | "name">, scheme: string): GroupShortcut {
  return { id: `block-${group.id}`, shortLabel: group.name, longLabel: `Block ${group.name}`, url: `${scheme}://pause/${group.id}` };
}

/** The shortcuts under the app's icon: the first groups, in the household's order. */
export function groupShortcuts(groups: readonly Pick<Group, "id" | "name">[], scheme: string): GroupShortcut[] {
  return groups.slice(0, GROUP_SHORTCUTS_MAX).map((group) => groupShortcut(group, scheme));
}

/** The app's Home screen shortcuts screen on Android. */
export const HOME_SHORTCUTS_COPY = {
  title: "Home screen shortcuts",
  section: "Block from your Home screen",
  intro:
    "Press and hold the FamilyFi icon to block one of your first four groups, or add any group to your Home screen here. A shortcut opens FamilyFi at that group's Block choices.",
  groups: "Groups",
  add: "Add to Home screen",
  addFor: (name: string) => `Add ${name} to your Home screen`,
  /** Android asks the person to confirm, so this only says it was asked. */
  asked: "Check your Home screen to finish adding it.",
  unsupported: "Your launcher can't add shortcuts this way. Press and hold the FamilyFi icon instead.",
  noGroups: "No groups yet.",
} as const;
