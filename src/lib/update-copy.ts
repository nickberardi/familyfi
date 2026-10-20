import { formatHhmm, relativeDayLabel } from "./display";
import { compareSemver, parseSemver } from "./semver";
import type { UpdateCheck, UpdateRun, UpdateSettings } from "./types";
import { probeScheduleWhen } from "./upstream";

/** A release as it is named everywhere: "v1.2.3", whether or not the tag had its "v". */
export function versionLabel(version: string): string {
  return `v${version.replace(/^v/i, "")}`;
}

/** The update's words, on Settings' Maintenance tab. */
export const UPDATE_COPY = {
  title: "Update",
  sub: "Release notes and installation.",
  checking: "Checking for updates…",
  unavailable: "Update check unavailable.",
  releaseNotes: "Release notes",
  viewOnGitHub: "View on GitHub",
  showAllChanges: "Show all changes",
  showFewerChanges: "Show fewer changes",
  noNotes: "This release has no notes. See the full release on GitHub.",
  installNote:
    "Installing from here needs the Watchtower updater beside FamilyFi; the setup guide explains it. Until then, pull the new image and restart FamilyFi. It applies database changes on start, and your UniFi policies stay in place meanwhile.",
  installReady:
    "Watchtower backs up the database, then replaces FamilyFi with the new release. FamilyFi is away for a minute or two; your UniFi policies stay in place meanwhile, and this page reconnects by itself.",
  // Where pre-update-backup.sh puts its dump: /var/lib/familyfi/data/backups on the app volume (docker/docker-compose.yml).
  backupWhere: "Before installing, the database is backed up to the backups folder on FamilyFi's data volume, familyfi-app_data. The newest three backups are kept.",
  installConfirm: "FamilyFi restarts on the new release and is away for a minute or two.",
  installFailed: "Could not start the install.",
  installOverlay: "FamilyFi restarts on the new release. Your UniFi policies stay in place, and this page reloads by itself when it is back.",
  notNow: "Not now",
  schedule: "Automatic updates",
  scheduleSub: "Install a newer release on its own, in the household's time.",
  scheduleTime: "Time",
  scheduleNeedsUpdater: "Automatic updates need the Watchtower updater beside FamilyFi; the setup guide explains it.",
  scheduleFailed: "Could not save the schedule.",
} as const;

/** The newer release on offer, or null when there is none (or the check has not answered). */
export function latestRelease(update: UpdateCheck | null | undefined): string | null {
  return update?.available && update.latestVersion ? versionLabel(update.latestVersion) : null;
}

/** What the update says when no newer release is on offer. */
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
    href: "/settings?tab=maintenance",
  };
}

/** The install card's title and button; without the updater the button names what is missing. */
export function installCopy(latest: string, configured = false) {
  return { title: `Install ${latest}`, button: configured ? `Install ${latest}` : `Install ${latest} · needs the updater` };
}

/** True while an install is under way, when a second one would be refused. */
export function installing(settings: UpdateSettings | null | undefined): boolean {
  return settings?.lastRun?.status === "requested";
}

/** The last install in a line: under way, or how it ended. */
export function updateRunLine(run: UpdateRun | null | undefined): string | null {
  if (!run) return null;
  const target = versionLabel(run.targetVersion);
  switch (run.status) {
    case "requested":
      return `Installing ${target}… FamilyFi restarts on its own; this page reconnects by itself.`;
    case "succeeded":
      return `Installed ${target}.`;
    case "unchanged":
    case "skipped":
      return `${target} was not installed. ${run.error ?? ""}`.trim();
    case "failed":
      return `Installing ${target} failed. ${run.error ?? ""}`.trim();
  }
}

/** How long an install usually takes, from the request to the new release answering. */
export const INSTALL_ESTIMATE_MS = 2 * 60 * 1000;

/**
 * The countdown beside the install spinner: "About 1:45 left" from when the install was asked for,
 * then "Taking longer than usual" once the estimate has passed. FamilyFi cannot tell how far
 * Watchtower has got, so this is an estimate. A start after `seenAt`, when this device first saw the
 * install (its clock is behind the server's), counts from `seenAt` instead.
 */
export function installCountdownLine(requestedAt: string, now: Date, seenAt: Date = now): string {
  const started = Math.min(new Date(requestedAt).getTime(), seenAt.getTime());
  const left = Math.ceil((INSTALL_ESTIMATE_MS - (now.getTime() - started)) / 1000);
  if (!(left > 0)) return "Taking longer than usual, still installing…";
  return `About ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
}

/**
 * True once the release FamilyFi reports running is the one being installed or newer, as the server
 * settles an install: Watchtower may pull a release published after the check.
 */
export function installedVersion(currentVersion: string, targetVersion: string): boolean {
  const current = parseSemver(currentVersion);
  const target = parseSemver(targetVersion);
  return current && target ? compareSemver(current, target) >= 0 : versionLabel(currentVersion) === versionLabel(targetVersion);
}

/** When FamilyFi installs on its own: "Sunday at 12:00 AM · next Sunday", or why it does not. */
export function updateScheduleLine(settings: UpdateSettings, timezone: string, now: Date): string {
  if (!settings.updater.configured) return UPDATE_COPY.scheduleNeedsUpdater;
  const { enabled, days, time } = settings.schedule;
  if (!enabled) return "Off — install from this page";
  const when = `${probeScheduleWhen(days)} at ${formatHhmm(time)}`;
  return settings.nextRunAt ? `${when} · next ${relativeDayLabel(new Date(settings.nextRunAt), timezone, now)}` : when;
}
