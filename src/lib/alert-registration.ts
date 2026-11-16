import type { ApiRequest } from "./api-client";
import { ALERT_FORMAT, ALERT_KINDS, isAlertKind, type AlertKind } from "./alert-kinds";
import { compareSemver, parseSemver } from "./semver";

/**
 * How the FamilyFi app signs up for alerts on its own server, and what its Alerts screen says. The
 * app makes a random 32-byte key and keeps it where only it and its notification extension can read
 * it; it sends the key, with the push token Apple or Google gave it, only to its own server, which
 * locks each alert with it (src/server/alerts/payload.ts). Only an app's own paired device (an
 * `app:full` sign-in, its own id) may call these.
 */

/** The first contract with alerts. An older server has none of these routes. */
export const ALERTS_MIN_API = "1.4.0";

/** Whether a server, by the `apiVersion` its `/health` reports, can send alerts. */
export function supportsAlerts(apiVersion: string | null | undefined): boolean {
  const server = parseSemver(apiVersion ?? "");
  return Boolean(server) && compareSemver(server!, parseSemver(ALERTS_MIN_API)!) >= 0;
}

export type AlertPlatform = "ios" | "android";
/** `development` for a build that gets its push token from Apple's sandbox. */
export type AlertChannel = "release" | "development";

/** Each kind on or off for this device. */
export type AlertChoices = { kinds: Record<string, boolean> };
/** How the push and alerts routes answer: the device's choices under `alerts`. */
export type AlertChoicesResponse = { alerts: AlertChoices };

export type AlertRegistration = {
  platform: AlertPlatform;
  channel: AlertChannel;
  /** Apple's device token, in hex, or the Firebase registration token. */
  token: string;
  /** The device's key, 32 bytes in base64. */
  key: string;
};

const path = (deviceId: string, leaf: "push" | "alerts") => `/api/v1/paired/devices/${encodeURIComponent(deviceId)}/${leaf}`;

/**
 * Signs this app up, or replaces its token or key; the kinds it can show are the ones this build
 * knows. Choices it made before are kept.
 */
export async function registerAlerts(request: ApiRequest, deviceId: string, registration: AlertRegistration): Promise<AlertChoices> {
  const answer = await request<AlertChoicesResponse>(path(deviceId, "push"), {
    method: "PUT",
    body: { ...registration, format: ALERT_FORMAT, kinds: [...ALERT_KINDS] },
  });
  return answer.alerts;
}

/** Forgets this app's token and key: its server sends it nothing more. */
export function unregisterAlerts(request: ApiRequest, deviceId: string): Promise<void> {
  return request<void>(path(deviceId, "push"), { method: "DELETE" });
}

export async function readAlertChoices(request: ApiRequest, deviceId: string): Promise<AlertChoices> {
  return (await request<AlertChoicesResponse>(path(deviceId, "alerts"))).alerts;
}

/** Turns one kind on or off for this app, leaving the rest. */
export async function setAlertChoice(request: ApiRequest, deviceId: string, kind: AlertKind, on: boolean): Promise<AlertChoices> {
  return (await request<AlertChoicesResponse>(path(deviceId, "alerts"), { method: "PUT", body: { kinds: { [kind]: on } } })).alerts;
}

/**
 * The kinds an Alerts screen lists, in this build's order, each with whether it is on. A kind the
 * server does not answer for reads as on, as the server starts every kind.
 */
export function alertChoiceRows(choices: AlertChoices | null): { kind: AlertKind; on: boolean }[] {
  return ALERT_KINDS.map((kind) => ({ kind, on: choices?.kinds[kind] !== false }));
}

/** Where a tapped alert opens in the app: new devices in Unassigned, gateway trouble on Sync. */
export function alertDestination(kind: string): string {
  if (!isAlertKind(kind)) return "/";
  return kind === "device.new" ? "/devices?filter=loose" : "/sync";
}

/** The app's Alerts screen. */
export const ALERTS_SCREEN_COPY = {
  title: "Alerts",
  intro: "Get an alert on this device when a new device is waiting in Unassigned, or when FamilyFi can't reach your gateway.",
  /** The one switch for this device's alerts; turning it on asks to send notifications. */
  deviceSwitch: "Alerts on this device",
  /** The system's notification permission was refused. */
  blocked: "Notifications are off for FamilyFi. Turn them on in this device's Settings to get alerts.",
  openSettings: "Open Settings",
  /** The household's switch (the Alerts card in FamilyFi's Settings, Household tab) is off. */
  householdOff: "Alerts are off for your household. Turn on “Send alerts to the FamilyFi app” in FamilyFi's Settings.",
  householdSettings: "Open Settings",
  /** The server is older than 1.4.0. */
  unsupported: "Your FamilyFi server is too old to send alerts. Update it to get them.",
  kindsTitle: "Send alerts about",
  failed: "Couldn't change alerts. Try again.",
  /** This device's alerts could not be read from the server. */
  unreadable: "Couldn't read this device's alerts.",
  tryAgain: "Try again",
} as const;
