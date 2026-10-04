import type { ApiRequest } from "./api-client";
import { verifyManifest, type EndpointManifest } from "./companion-trust";
import type { ConnectionProfile } from "./companion-pairing";
import type { Group, PairedPhone, Session } from "./types";

/**
 * A paired iPhone's Watches: which groups each shows, how the phone enrolls one, and what the phone
 * hands it. Each Watch is its own paired device, set up by the phone (its parent): it receives its
 * own bearer and refresh token, never the phone's, and talks to `/api/v1` directly with them. A phone
 * can set up several; unpairing or revoking the phone revokes them too.
 */

/** The most groups a Watch shows, in the order the phone chose. */
export const WATCH_MAX_GROUPS = 8;

/**
 * The phone's choice of groups for each of its Watches, by the Watch's lowercased id, with the paired
 * device it was enrolled as: only ids and order cross to the Watches, with the household's time zone,
 * which a Watch session cannot read but its labels are written in. Each Watch takes its own entry.
 */
export type WatchSelection = { watches: Record<string, WatchEntry>; timeZone: string };
export type WatchEntry = { deviceId: string; groupIds: string[] };

/** A Watch's chosen group ids, or none yet. */
export function watchGroupIds(selection: WatchSelection | null, watchId: string): string[] {
  return selection?.watches[watchId.toLowerCase()]?.groupIds ?? [];
}

/**
 * The selection once a Watch is set up as `deviceId`: setting the same Watch up again keeps its
 * groups; a new Watch starts with none.
 */
export function withWatch(selection: WatchSelection | null, watchId: string, deviceId: string, timeZone: string): WatchSelection {
  return {
    watches: { ...selection?.watches, [watchId.toLowerCase()]: { deviceId, groupIds: watchGroupIds(selection, watchId) } },
    timeZone,
  };
}

/** The selection with only the Watches still set up from this phone (by paired device id). */
export function keepWatches(selection: WatchSelection, deviceIds: readonly string[]): WatchSelection {
  const kept = new Set(deviceIds);
  return { ...selection, watches: Object.fromEntries(Object.entries(selection.watches).filter(([, entry]) => kept.has(entry.deviceId))) };
}

/** The Watch id (as enrolled) of the entry for one of this phone's paired Watches, or null. */
export function watchIdForDevice(selection: WatchSelection | null, deviceId: string): string | null {
  return Object.entries(selection?.watches ?? {}).find(([, entry]) => entry.deviceId === deviceId)?.[0] ?? null;
}

/** The saved ids that still name a group, each once, at most `WATCH_MAX_GROUPS`. */
export function reconcileWatchSelection(ids: readonly string[], groups: readonly Pick<Group, "id">[]): string[] {
  const known = new Set(groups.map((group) => group.id));
  const seen = new Set<string>();
  return ids.filter((id) => known.has(id) && !seen.has(id) && Boolean(seen.add(id))).slice(0, WATCH_MAX_GROUPS);
}

/** Every Watch's groups reconciled with the household's (`reconcileWatchSelection`), in its time zone. */
export function reconcileWatches(selection: WatchSelection, groups: readonly Pick<Group, "id">[], timeZone: string): WatchSelection {
  return {
    watches: Object.fromEntries(Object.entries(selection.watches).map(([id, entry]) => [id, { ...entry, groupIds: reconcileWatchSelection(entry.groupIds, groups) }])),
    timeZone,
  };
}

/** The chosen groups, in the chosen order. */
export function orderedWatchGroups<T extends Pick<Group, "id">>(ids: readonly string[], groups: readonly T[]): T[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return reconcileWatchSelection(ids, groups).map((id) => byId.get(id)!);
}

/** What `POST /api/v1/paired/invites?claim=true` answers for a Watch: its device, session and signed routes. */
export type WatchEnrollment = {
  device: { id: string; displayName: string };
  session: Session;
  token: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connection: { manifest: EndpointManifest };
};

/**
 * Enrolls the Watch the phone can reach as its own paired device, in one call: the phone invites and
 * claims it. The Watch's id is its own; enrolling the same Watch again replaces its earlier record.
 */
export function enrollWatch(request: ApiRequest, watchId: string): Promise<WatchEnrollment> {
  return request<WatchEnrollment>("/api/v1/paired/invites?claim=true", {
    method: "POST",
    body: { client: "watch", clientId: watchId.toLowerCase() },
  });
}

/**
 * What the phone sends the Watch: the Watch's own tokens, the household's key, and the Watch's own
 * signed manifest, which the Watch verifies with that key. Never the phone's bearer. The phone checks
 * the manifest first, so it never hands on one the household's key did not sign.
 */
export type WatchProvisioning = {
  watchId: string;
  deviceId: string;
  token: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  trust: { instanceId: string; publicKeyX: string };
  manifest: EndpointManifest;
};

export function watchProvisioning(
  watchId: string,
  enrollment: WatchEnrollment,
  profile: Pick<ConnectionProfile, "instanceId" | "publicKeyX">,
): WatchProvisioning {
  verifyManifest(enrollment.connection.manifest, profile.publicKeyX, profile.instanceId);
  return {
    // Lowercased, as it was enrolled (`enrollWatch`).
    watchId: watchId.toLowerCase(),
    deviceId: enrollment.device.id,
    token: enrollment.token,
    expiresAt: enrollment.session.expiresAt,
    refreshToken: enrollment.refreshToken,
    refreshExpiresAt: enrollment.refreshExpiresAt,
    trust: { instanceId: profile.instanceId, publicKeyX: profile.publicKeyX },
    manifest: enrollment.connection.manifest,
  };
}

/** The Watches this phone set up that still work, from the devices the phone may see. */
export async function listWatches(request: ApiRequest, phoneDeviceId: string): Promise<PairedPhone[]> {
  const { devices } = await request<{ devices: PairedPhone[] }>("/api/v1/paired/devices?client=watch&status=active");
  return devices.filter((device) => device.parentDeviceId === phoneDeviceId);
}

/** Revokes one of this phone's Watches: the household stops accepting it. */
export function removeWatch(request: ApiRequest, watch: Pick<PairedPhone, "id">): Promise<unknown> {
  return request(`/api/v1/paired/devices/${encodeURIComponent(watch.id)}`, { method: "DELETE" });
}

/** Renames one of this phone's Watches, as the household lists it; a Watch reports only "Apple Watch". */
export function renameWatch(request: ApiRequest, watch: Pick<PairedPhone, "id">, displayName: string): Promise<{ device: PairedPhone }> {
  return request(`/api/v1/paired/devices/${encodeURIComponent(watch.id)}`, { method: "PATCH", body: { displayName: displayName.trim() } });
}

/** The Watch setup screen's words. */
export const WATCH_COPY = {
  title: "Watch",
  section: "Set up a Watch",
  intro: "Open FamilyFi on the Apple Watch this iPhone is using, then tap Set up Watch here. Keep both apps open until setup finishes.",
  setUp: "Set up Watch",
  settingUp: "Setting up…",
  ready: "This Watch is set up. It signs in on its own and stays signed in while it is used.",
  unavailable: "Open FamilyFi on the paired Watch and keep the iPhone nearby.",
  storeFailed: "The Watch could not store its session. Try setup again.",
  noWatch: "No Apple Watch is paired with this iPhone.",
  watches: "Watches set up from this phone",
  none: "No Watch is set up from this phone yet.",
  onWatch: "On this Watch",
  choose: "Choose up to eight groups to show on this Watch.",
  available: "More groups",
  moveUp: "Move up",
  moveDown: "Move down",
  add: "Add",
  remove: "Remove",
  rename: "Rename",
  renameTitle: "Rename this Watch",
  renameBody: "The name FamilyFi lists it by, here and on the web.",
  renameConfirm: "Save",
  removeWatch: "Remove Watch",
  removeTitle: "Remove this Watch?",
  removeBody: "It stops working with this household. To use FamilyFi on it again, set it up from this phone.",
  removeConfirm: "Remove",
  cancel: "Cancel",
  ipad: "Set up and manage a Watch from the iPhone it is paired with.",
} as const;
