import type { UpdateCheck } from "./types";

/** A release as it is named everywhere: "v1.2.3", whether or not the tag had its "v". */
export function versionLabel(version: string): string {
  return `v${version.replace(/^v/i, "")}`;
}

/** What an in-app install will do, in order. Shown as a preview: there is no installer yet. */
export const INSTALL_STEPS = [
  "Back up the database",
  "Download the new release",
  "Apply database changes",
  "Restart FamilyFi",
  "Reconcile app-owned policies",
] as const;

/** The Update page's words. */
export const UPDATE_COPY = {
  title: "Update",
  sub: "Release notes and installation.",
  checking: "Checking for updates…",
  unavailable: "Update check unavailable.",
  releaseNotes: "Release notes",
  viewOnGitHub: "View on GitHub",
  noNotes: "This release has no notes. See the full release on GitHub.",
  installNote:
    "In-app install is coming soon. Until then, pull the new image and restart FamilyFi. It applies database changes on start, and your UniFi policies stay in place meanwhile.",
  notNow: "Not now",
} as const;

/** The newer release on offer, or null when there is none (or the check has not answered). */
export function latestRelease(update: UpdateCheck | null | undefined): string | null {
  return update?.available && update.latestVersion ? versionLabel(update.latestVersion) : null;
}

/** What the Update page says when no newer release is on offer. */
export function upToDateLine(update: UpdateCheck | null | undefined): string {
  if (!update || update.status === "pending") return UPDATE_COPY.checking;
  if (update.status === "error") return UPDATE_COPY.unavailable;
  return `FamilyFi ${versionLabel(update.currentVersion)} is up to date.`;
}

/** The "Update available" alert beside the navigation, or null when there is nothing newer. */
export function updateAlert(update: UpdateCheck | null | undefined) {
  const latest = latestRelease(update);
  if (!latest || !update) return null;
  return {
    title: "Update available",
    body: `${latest} is ready. You’re on ${versionLabel(update.currentVersion)}.`,
    action: "Update",
    href: "/update",
  };
}

/** The install card's title and button while install is not built yet. */
export function installCopy(latest: string) {
  return { title: `Install ${latest}`, button: `Install ${latest} · coming soon` };
}
