import type { ApiRequest } from "./api-client";
import type { EndpointCredential } from "./companion-trust";
import type { ConnectionProfile } from "./companion-pairing";
import type { ConnectionRoute, Group } from "./types";

/**
 * A paired iPhone's Watch: which groups it shows, how the phone enrolls it, and what the phone hands
 * it. The Watch is its own paired device: it receives its own device credential, bearer and refresh
 * token, never the phone's, and talks to `/api/v1` directly with them.
 */

/** The most groups a Watch shows, in the order the phone chose. */
export const WATCH_MAX_GROUPS = 8;

/**
 * The phone's choice of groups for its Watch: only ids and order cross to the Watch, with the
 * household's time zone, which a Watch session cannot read but its labels are written in.
 */
export type WatchSelection = { watchId: string; groupIds: string[]; timeZone: string };

/** The saved ids that still name a group, each once, at most `WATCH_MAX_GROUPS`. */
export function reconcileWatchSelection(ids: readonly string[], groups: readonly Pick<Group, "id">[]): string[] {
  const known = new Set(groups.map((group) => group.id));
  const seen = new Set<string>();
  return ids.filter((id) => known.has(id) && !seen.has(id) && Boolean(seen.add(id))).slice(0, WATCH_MAX_GROUPS);
}

/** The chosen groups, in the chosen order. */
export function orderedWatchGroups<T extends Pick<Group, "id">>(ids: readonly string[], groups: readonly T[]): T[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return reconcileWatchSelection(ids, groups).map((id) => byId.get(id)!);
}

/** What `POST /api/v1/connection/devices` returns for a Watch. */
export type WatchEnrollment = {
  deviceId: string;
  deviceCredential: string;
  sessionId: string;
  token: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

/** Enrolls the Watch the phone can reach as its own paired device. The Watch's id is its own. */
export function enrollWatch(request: ApiRequest, watchId: string): Promise<WatchEnrollment> {
  return request<WatchEnrollment>("/api/v1/connection/devices", { method: "POST", body: { client: "watch", clientId: watchId.toLowerCase() } });
}

/**
 * What the phone sends the Watch: the Watch's own credential and tokens, and how to trust the
 * household (its key, routes and Access credentials). Never the phone's bearer or credential.
 */
export type WatchProvisioning = {
  watchId: string;
  deviceId: string;
  deviceCredential: string;
  sessionId: string;
  token: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  trust: { instanceId: string; publicKeyX: string; endpoints: ConnectionRoute[] };
  edgeCredentials: EndpointCredential[];
};

export function watchProvisioning(
  watchId: string,
  enrollment: WatchEnrollment,
  profile: Pick<ConnectionProfile, "instanceId" | "publicKeyX" | "endpoints">,
  edgeCredentials: EndpointCredential[],
): WatchProvisioning {
  return {
    watchId,
    deviceId: enrollment.deviceId,
    deviceCredential: enrollment.deviceCredential,
    sessionId: enrollment.sessionId,
    token: enrollment.token,
    expiresAt: enrollment.expiresAt,
    refreshToken: enrollment.refreshToken,
    refreshExpiresAt: enrollment.refreshExpiresAt,
    trust: { instanceId: profile.instanceId, publicKeyX: profile.publicKeyX, endpoints: profile.endpoints },
    edgeCredentials,
  };
}

/** The Watch setup screen's words. */
export const WATCH_COPY = {
  title: "Watch",
  section: "This phone's Watch",
  intro: "Open FamilyFi on your paired Apple Watch, then tap Set up Watch here. Keep both apps open until setup finishes.",
  setUp: "Set up Watch",
  setUpAgain: "Set up Watch again",
  settingUp: "Setting up…",
  ready: "Your Watch is set up. It signs in on its own and stays signed in while it is used.",
  unavailable: "Open FamilyFi on the paired Watch and keep the iPhone nearby.",
  storeFailed: "The Watch could not store its session. Try setup again.",
  noWatch: "No Apple Watch is paired with this iPhone.",
  onWatch: "On your Watch",
  choose: "Choose up to eight groups to show on your Watch.",
  available: "More groups",
  moveUp: "Move up",
  moveDown: "Move down",
  add: "Add",
  remove: "Remove",
  ipad: "Set up and manage the Watch from the iPhone it is paired with.",
} as const;
