import type { ApiRequest } from "./api-client";
import type { ConnectionProfile } from "./companion-pairing";
import { isAppControls } from "./pair-device";
import { compareSemver, parseSemver } from "./semver";
import type { PairedPhone } from "./types";
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

/** What the household's Pair Device list calls an app's controls. */
export function appControlsName(deviceName: string | null | undefined): string {
  const name = deviceName?.trim();
  return (name ? `Siri and shortcuts on ${name}` : "Siri and shortcuts").slice(0, 80);
}

/**
 * Enrolls this app's controls, in one call: the app invites and claims them. `controlsId` is an id
 * the app makes once and keeps; enrolling it again replaces the earlier record.
 */
export function enrollAppControls(request: ApiRequest, controlsId: string, deviceName?: string | null): Promise<WatchEnrollment> {
  return request<WatchEnrollment>("/api/v1/paired/invites?claim=true", {
    method: "POST",
    body: { client: "app", scope: "rulesOnly", clientId: controlsId.toLowerCase(), displayName: appControlsName(deviceName) },
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
