import type { SyncStatus } from "./types";

const ACTION: Record<string, string> = {
  pause: "Pause all internet",
  resume: "Resume internet",
  extend: "Extend pause",
  allow: "Allow internet",
  rule: "Update rule",
  // Before household rules, a group's bedtime; kept so older history reads.
  schedule: "Update schedule",
  group: "Update group",
  assignment: "Assign device",
  unifi: "Update UniFi settings",
  quarantine: "Update quarantine blocking",
  household: "Update household",
  account: "Update account",
  retry: "Reconcile sweep",
};

export function changeActionLabel(scope: string): string {
  return ACTION[scope] ?? scope;
}

export function changeResultLabel(status: string): string {
  if (status === "applied") return "Applied";
  if (status === "failed") return "Failed";
  if (status === "partial") return "Partial";
  if (status === "pending") return "Pending";
  if (status === "superseded") return "Superseded";
  return status;
}

export function changeResultColor(status: string): string {
  if (status === "applied") return "var(--ff-on)";
  if (status === "failed" || status === "partial") return "var(--ff-danger)";
  if (status === "pending") return "var(--ff-paused)";
  return "var(--ff-muted)";
}

export function relativeSweep(iso: string | null, now = new Date()): string {
  if (!iso) return "Never";
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function changePolicyLabel(deviceMac: string | null): string {
  return deviceMac ? deviceMac.toUpperCase() : "—";
}

export function issueActionLabel(kind: string): string {
  if (kind === "no_members") return "Needs assigned devices";
  if (kind === "unresolved_zone") return "Devices have no firewall zone";
  return "Missing UniFi policy";
}

export function issueResultLabel(kind: string): string {
  if (kind === "no_members") return "Can't create";
  return "Failed";
}

export function issueResultColor(kind: string): string {
  if (kind === "no_members") return "var(--ff-paused)";
  return "var(--ff-danger)";
}

export function noMembersAttention(
  issues: Array<{ kind: string; groupId: string; groupName: string; message: string }>,
): { title: string; message: string; href: string } | null {
  const rows = issues.filter((issue) => issue.kind === "no_members");
  if (rows.length === 0) return null;
  const names = rows.map((row) => row.groupName);
  const title = names.length === 1 ? `${names[0]} needs devices` : `${names.join(" and ")} need devices`;
  return {
    title,
    message: rows[0]!.message,
    href: `/devices?assign=${rows[0]!.groupId}`,
  };
}

export function formatLogWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** The Sync page's words. */
export const SYNC_COPY = {
  title: "Sync",
  sub: "App-owned policy state, sweeps, and failures.",
  when: "When",
  action: "Action",
  result: "Result",
  now: "Now",
  empty: "No changes yet. Reconcile writes desired state to UniFi.",
  /** Around the mono "FamilyFi" in the ownership note. */
  ownership: {
    before: "Only policies FamilyFi created appear here — named with a",
    prefix: "FamilyFi",
    after: "prefix. Ownership is the recorded policy ID, not the name. Administrator rules are never modified, disabled, or reordered.",
  },
} as const;

export type SyncStat = { label: string; value: string; ink: string; note: string };

/** When the last sweep finished, or started if it is still running. */
export function lastSweepAt(sync: Pick<SyncStatus, "lastRun"> | null | undefined): string | null {
  return sync?.lastRun?.finishedAt ?? sync?.lastRun?.startedAt ?? null;
}

/** The four tiles above the log: policies FamilyFi owns, admin policies touched, failing, last sweep. */
export function syncStats(sync: SyncStatus | null | undefined, now = new Date()): SyncStat[] {
  const run = sync?.lastRun;
  const failing = sync?.failingCount ?? 0;
  const writeIssue = (sync?.issues ?? []).find((issue) => issue.kind !== "no_members");
  const failingNote = writeIssue?.message ?? run?.error ?? "see the log";
  return [
    { label: "App-owned policies", value: String(sync?.appPolicyCount ?? 0), ink: "var(--ff-ink)", note: "named FamilyFi …" },
    { label: "Admin policies touched", value: "0", ink: "var(--ff-on)", note: "never modified or reordered" },
    {
      label: "Failing",
      value: String(failing),
      ink: failing ? "var(--ff-danger)" : "var(--ff-on)",
      note: failing ? failingNote : "nothing queued",
    },
    {
      label: "Last sweep",
      value: relativeSweep(lastSweepAt(sync), now),
      ink: run?.status === "failed" ? "var(--ff-danger)" : "var(--ff-ink)",
      note: run ? `${run.status} · revision ${run.appliedRevision ?? run.requestedRevision}` : "no sweep yet",
    },
  ];
}

export type SyncLogRow = {
  key: string;
  when: string;
  action: string;
  /** A line under the action: an issue's or failure's message, or a change's device. */
  detail: string | null;
  detailInk: string;
  detailMono: boolean;
  result: string;
  resultInk: string;
};

/**
 * Whenever sync is flagged as needing attention, the log's first row says why, so the flag never
 * points at a log with nothing in it: a sweep that stopped or only partly applied (often with no
 * pending change to carry its error), a gateway connection in error, or policies failing to write.
 */
function flaggedRow(sync: SyncStatus | null | undefined, sweepAt: string | null, timezone: string): SyncLogRow | null {
  if (!sync || !syncFailed(sync)) return null;
  const run = sync.lastRun;
  const when = sweepAt ? formatLogWhen(sweepAt, timezone) : SYNC_COPY.now;
  const row = (key: string, action: string, detail: string, status: "failed" | "partial"): SyncLogRow => ({
    key,
    when,
    action,
    detail,
    detailInk: "var(--ff-danger)",
    detailMono: false,
    result: changeResultLabel(status),
    resultInk: changeResultColor(status),
  });
  const failing = sync.failingCount === 1 ? "1 policy couldn't be written to UniFi." : `${sync.failingCount} policies couldn't be written to UniFi.`;
  if (run && (run.status === "failed" || run.status === "partial")) {
    return row(`run-${run.id}`, changeActionLabel("retry"), run.error ?? failing, run.status);
  }
  if (sync.connectionStatus === "error") {
    return row("connection", "Reach UniFi", run?.error ?? "The last sync couldn't reach the gateway. FamilyFi is trying again.", "failed");
  }
  return row("failing", changeActionLabel("retry"), failing, "failed");
}

/** The log, as the Sync page lists it: why sync is flagged, the current issues at the last sweep, then every change, newest first. */
export function syncLogRows(sync: SyncStatus | null | undefined, timezone: string): SyncLogRow[] {
  const sweepAt = lastSweepAt(sync);
  const flagged = flaggedRow(sync, sweepAt, timezone);
  const issues = (sync?.issues ?? []).map((issue): SyncLogRow => ({
    key: `issue-${issue.groupId}`,
    when: sweepAt ? formatLogWhen(sweepAt, timezone) : SYNC_COPY.now,
    action: issueActionLabel(issue.kind),
    detail: issue.message,
    detailInk: issueResultColor(issue.kind),
    detailMono: false,
    result: issueResultLabel(issue.kind),
    resultInk: issueResultColor(issue.kind),
  }));
  const changes = (sync?.changes ?? []).map((change): SyncLogRow => ({
    key: change.id,
    when: formatLogWhen(change.updatedAt, timezone),
    action: changeActionLabel(change.scope),
    detail: change.error || (change.deviceMac ? changePolicyLabel(change.deviceMac) : null),
    detailInk: change.error ? "var(--ff-danger)" : "var(--ff-muted)",
    detailMono: !change.error && Boolean(change.deviceMac),
    result: changeResultLabel(change.status),
    resultInk: changeResultColor(change.status),
  }));
  return [...(flagged ? [flagged] : []), ...issues, ...changes];
}

/** Whether sync needs attention: the last sweep failed, UniFi is unreachable, or a policy is failing. */
export function syncFailed(sync: Pick<SyncStatus, "lastRun" | "connectionStatus" | "failingCount"> | null | undefined): boolean {
  return sync?.lastRun?.status === "failed" || sync?.connectionStatus === "error" || (sync?.failingCount ?? 0) > 0;
}

export type SyncProblem = { title: string; message: string; detail: string | null; fix: string };

/**
 * Why sync stopped, in words a parent can act on, when FamilyFi could not finish talking to the
 * gateway: the last sweep failed, or the gateway connection is in error. Write failures on single
 * policies are the Failing tile's and the log's, not this. `detail` is UniFi's own error, if any.
 */
export function syncProblem(sync: Pick<SyncStatus, "lastRun" | "connectionStatus"> | null | undefined): SyncProblem | null {
  const run = sync?.lastRun;
  const sweepFailed = run?.status === "failed";
  if (!sweepFailed && sync?.connectionStatus !== "error") return null;
  const detail = run?.error ?? null;
  const retry = "FamilyFi tries again every 30 seconds, so a short outage clears by itself.";
  if (detail && /\btimed out$/.test(detail)) {
    return {
      title: "UniFi isn't answering",
      message: "The gateway didn't answer FamilyFi in time, so this sync stopped. Your rules already on the gateway keep working.",
      detail,
      fix: `${retry} If it keeps happening, check that the gateway is online and not overloaded, and that the FamilyFi server can reach the gateway address in FamilyFi's web Settings.`,
    };
  }
  if (detail && /HTTP 40[13]\b/.test(detail)) {
    return {
      title: "UniFi refused the API key",
      message: "The gateway turned down FamilyFi's key, so this sync stopped. Your rules already on the gateway keep working.",
      detail,
      fix: "Create a new Integration API key on the UniFi console and replace it in FamilyFi's web Settings.",
    };
  }
  return {
    title: "Sync couldn't reach UniFi",
    message: detail
      ? "FamilyFi couldn't finish talking to the gateway, so this sync stopped. Your rules already on the gateway keep working."
      : "The last sync couldn't reach the gateway. FamilyFi is trying again.",
    detail,
    fix: `${retry} If it keeps happening, check that the gateway is online and that its address and key in FamilyFi's web Settings are right.`,
  };
}

/** How many family groups have rules that cannot be created until they have a device: the Family badge. */
export function familyNeedsDevices(sync: Pick<SyncStatus, "issues"> | null | undefined): number {
  return (sync?.issues ?? []).filter((issue) => issue.kind === "no_members").length;
}

/**
 * The sync status card beside the navigation: what state the gateway is in, why, and whether to
 * offer Reconcile now. `busy`, `error` and `notice` are the household store's.
 */
export function syncStatusCard(
  sync: SyncStatus | null | undefined,
  { busy = false, error = "", notice = "" }: { busy?: boolean; error?: string | null; notice?: string | null } = {},
) {
  const failed = syncFailed(sync);
  const unconfigured = sync?.connectionStatus === "unconfigured";
  const partial = sync?.lastRun?.status === "partial";
  return {
    title: unconfigured ? "UniFi not configured" : failed ? "Sync needs attention" : partial ? "Partial apply" : "Gateway in sync",
    dot: unconfigured ? "var(--ff-muted)" : failed ? "var(--ff-danger)" : "var(--ff-on)",
    message: busy
      ? "Writing desired state to UniFi…"
      : error || notice || (failed ? sync?.lastRun?.error : null) || "Desired state is written on the next reconcile.",
    showReconcile: busy || unconfigured || failed || partial,
    reconcile: busy ? "Reconciling…" : "Reconcile now",
  };
}
