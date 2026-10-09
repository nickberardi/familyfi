import type { ImportSummary } from "./types";

/** The words of Settings' Backup card and the import it shares with setup. */
export const BACKUP_COPY = {
  title: "Backup",
  sub: "Export the household to a file, or restore one.",
  exportLabel: "Export household",
  exportNote:
    "A .tar.gz with your groups, rules, devices, administrator logins and settings, and a database dump for a full restore. It holds password hashes but no UniFi key or Cloudflare token: keep it somewhere safe.",
  importLabel: "Import an export",
  importNote: "Replaces this household's groups, rules, devices, logins and settings with the file's. Keys saved here are kept.",
  choose: "Choose a file",
  reading: "Reading the file…",
  apply: "Replace the household",
  applying: "Importing…",
  cancel: "Cancel",
  done: "Imported. FamilyFi is rebuilding the gateway's policies.",
  readFailed: "Could not read the file.",
  applyFailed: "Could not import the file.",
} as const;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** What an import will do, line by line, for the confirmation before it replaces the household. */
export function importSummaryLines(summary: ImportSummary): string[] {
  const { counts } = summary;
  const lines = [
    `From FamilyFi v${summary.appVersion}, exported ${summary.exportedAt.slice(0, 10)}.`,
    `${plural(counts.groups, "group")}, ${plural(counts.rules, "rule")}, ${plural(counts.devices, "device")}, ${plural(counts.accounts, "login")}, ${plural(counts.categories, "DNS category", "DNS categories")}, ${plural(counts.endpoints, "route")}.`,
  ];
  if (summary.gateway === "kept") lines.push("This install's gateway connection stays: its key is for another console or site.");
  if (summary.unifiKey === "missing") lines.push("No UniFi key is saved here: paste one after the import.");
  if (summary.endpointsNeedingToken.length > 0) {
    lines.push(`Switched off until you add their Cloudflare Access token: ${summary.endpointsNeedingToken.join(", ")}.`);
  }
  if (summary.skippedEndpoints.length > 0) lines.push("FamilyFi's own tunnel routes are not imported: turn remote access on again.");
  if (summary.otherInstallPolicies) {
    lines.push("Another FamilyFi install made this export on this same gateway. Its policies stay on the gateway; delete them in UniFi.");
  }
  lines.push("Phones, Watches and agents pair again; pairing is not part of an export.");
  return lines;
}
