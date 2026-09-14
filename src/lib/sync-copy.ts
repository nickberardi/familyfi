const ACTION: Record<string, string> = {
  pause: "Pause schedule",
  resume: "Resume schedule",
  extend: "Extend pause",
  schedule: "Update bedtime",
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
