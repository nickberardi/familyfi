import { changeActionLabel, changeResultColor, changeResultLabel, formatLogWhen, lastSweepAt, relativeSweep } from "./sync-copy";
import { connectionStatusLabel } from "./settings-copy";
import { routeTrust, transportLabel } from "./connection-routes";
import type { ConnectionRoute, SyncStatus, UnifiSettings } from "./types";

/**
 * A paired phone's view of its connection, as familyfi-ios's Connection screen reports it: "connected"
 * is three questions, so it answers each apart. This phone reaching FamilyFi is measured on the phone;
 * FamilyFi reaching the UniFi console is only relayed from the server; and the last change has its
 * own outcome. The phone never talks to UniFi.
 *
 * It also decides when the phone is offline: a flaky connection retries quickly before the phone says
 * so, and once it does, it keeps retrying until FamilyFi answers.
 */

/** How long after each failed refresh in a row the phone tries again: quickly at first, then steadily. */
export const OFFLINE_RETRY_MS = [2_000, 4_000, 8_000, 15_000] as const;

/** Failed refreshes in a row, each unable to reach FamilyFi at all, before the phone says it is offline. */
export const OFFLINE_AFTER_FAILURES = 3;

/** When to try again after `failures` failed refreshes in a row (1 or more). */
export function retryDelay(failures: number): number {
  return OFFLINE_RETRY_MS[Math.min(Math.max(failures, 1), OFFLINE_RETRY_MS.length) - 1]!;
}

/** Whether the phone has lost FamilyFi for long enough to say so, rather than a refresh that missed. */
export function isOffline(failures: number): boolean {
  return failures >= OFFLINE_AFTER_FAILURES;
}

export const HOP_COPY = {
  phone: "This phone",
  familyfi: "FamilyFi",
  unifi: "UniFi",
  note: "Two independently authenticated hops. Your phone never talks to UniFi.",
  offlineTitle: "Can't reach FamilyFi",
  offlineBody: "FamilyFi isn't answering on any of this phone's routes. The app is paused until it does, and keeps trying by itself.",
  retrying: "Trying again…",
  tryAgain: "Try again now",
} as const;

export type Hop = {
  /** A colour token for its dot and status: `var(--ff-…)`. */
  tone: string;
  section: string;
  status: string;
  detail: string;
  footnote: string | null;
};

export type PhoneHopState = "connected" | "checking" | "offline";

/** This phone → FamilyFi: measured here, on the route that last answered. */
export function phoneHop(state: PhoneHopState, route: Pick<ConnectionRoute, "url" | "transport" | "trustMode" | "spkiSha256" | "edgeAuth"> | null): Hop {
  const where = route ? `${transportLabel(route.transport)} · ${route.url}` : null;
  if (state === "offline") {
    return {
      tone: "var(--ff-danger)",
      section: "This phone → FamilyFi",
      status: "Not connected",
      detail: "No route answered. Check this phone is on the home network or that remote access is on.",
      footnote: where,
    };
  }
  if (state === "checking") {
    return { tone: "var(--ff-paused)", section: "This phone → FamilyFi", status: "Checking…", detail: "Measured from this phone.", footnote: where };
  }
  return {
    tone: "var(--ff-on)",
    section: "This phone → FamilyFi",
    status: "Connected",
    detail: route ? `${routeTrust(route)}. Measured from this phone, not reported by the server.` : "Measured from this phone.",
    footnote: where,
  };
}

/** FamilyFi → UniFi console: reported by the server, from the last household it sent. */
export function gatewayHop(unifi: Pick<UnifiSettings, "connectionStatus" | "connectionError"> | null, sync: SyncStatus | null, now = new Date()): Hop {
  const status = unifi?.connectionStatus ?? null;
  const tone = status === "connected" ? "var(--ff-on)" : status === "error" ? "var(--ff-danger)" : "var(--ff-muted)";
  const sweep = lastSweepAt(sync);
  return {
    tone,
    section: "FamilyFi → UniFi console",
    status: status ? connectionStatusLabel(status) : "Unknown",
    detail: unifi?.connectionError || "Local Network Integration API, key held by FamilyFi. Reported by the server, not measured from this phone.",
    footnote: sweep ? `Last sweep ${relativeSweep(sweep, now)}` : null,
  };
}

/** The household's latest change and how it landed. */
export function changeHop(sync: SyncStatus | null, timezone: string): Hop {
  const change = sync?.changes?.[0];
  if (!change) {
    return { tone: "var(--ff-muted)", section: "Your last change", status: "Nothing yet", detail: "Pause or resume something and its outcome shows up here.", footnote: null };
  }
  return {
    tone: changeResultColor(change.status),
    section: "Your last change",
    status: changeResultLabel(change.status),
    detail: change.error || `${changeActionLabel(change.scope)}: the gateway has the requested state.`,
    footnote: formatLogWhen(change.updatedAt, timezone),
  };
}

/** The diagram's two links: this phone to FamilyFi, and FamilyFi to UniFi, each with its word and tone. */
export function hopLinks(phone: PhoneHopState, unifi: Pick<UnifiSettings, "connectionStatus"> | null) {
  return {
    phone: { tone: phone === "connected" ? "var(--ff-on)" : phone === "checking" ? "var(--ff-paused)" : "var(--ff-danger)", label: phone === "offline" ? "Offline" : phone === "checking" ? "Checking" : "Direct" },
    unifi: {
      tone: unifi?.connectionStatus === "connected" ? "var(--ff-on)" : unifi?.connectionStatus === "error" ? "var(--ff-danger)" : "var(--ff-muted)",
      label: unifi ? connectionStatusLabel(unifi.connectionStatus) : "—",
    },
  };
}
