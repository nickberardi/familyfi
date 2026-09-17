/** Client-safe types and presentation for upstream categories. */

export type UpstreamVerdictValue = "blocked" | "partial" | "open" | "unknown";

export type UpstreamDomainRow = {
  id: string;
  domain: string;
  source: "seed" | "user";
  removed: boolean;
};

export type UpstreamCheckRow = {
  verdict: UpstreamVerdictValue;
  blockedCount: number;
  totalCount: number;
  checkedAt: string;
  error: string | null;
};

export type UpstreamCategoryRow = {
  id: string;
  slug: string;
  label: string;
  monogram: string;
  source: "seed" | "user";
  enabled: boolean;
  domains: UpstreamDomainRow[];
  activeDomainCount: number;
  costNote: string;
  check: UpstreamCheckRow | null;
};

export type UpstreamResolverSettings = {
  configured: boolean;
  mask: string | null;
  probeEnabled: boolean;
  intervalMinutes: number;
  timeoutMs: number;
};

type VerdictStyle = {
  label: string;
  ink: string;
  fill: string;
  line: string;
};

const VERDICT: Record<UpstreamVerdictValue, VerdictStyle> = {
  blocked: {
    label: "Blocked upstream",
    ink: "var(--ff-verdict-blocked-ink)",
    fill: "var(--ff-verdict-blocked-fill)",
    line: "var(--ff-verdict-blocked-line)",
  },
  partial: {
    label: "Partially blocked",
    ink: "var(--ff-verdict-partial-ink)",
    fill: "var(--ff-verdict-partial-fill)",
    line: "var(--ff-verdict-partial-line)",
  },
  open: {
    label: "Not blocked",
    ink: "var(--ff-verdict-open-ink)",
    fill: "var(--ff-verdict-open-fill)",
    line: "var(--ff-verdict-open-line)",
  },
  unknown: {
    label: "Not checked",
    ink: "var(--ff-verdict-unknown-ink)",
    fill: "var(--ff-verdict-unknown-fill)",
    line: "var(--ff-verdict-unknown-line)",
  },
};

export function verdictStyle(check: UpstreamCheckRow | null): VerdictStyle {
  return VERDICT[check?.verdict ?? "unknown"];
}

/**
 * The line under the chip. `unknown` says we could not look rather than implying
 * anything about what is filtered — the whole point of having a fourth state.
 */
export function verdictDetailText(check: UpstreamCheckRow | null): string {
  if (!check) return "Not checked yet";
  if (check.verdict === "unknown") return "Last check couldn't reach the resolver";
  return `${check.blockedCount} of ${check.totalCount} test domains blocked`;
}

export function sourceNoteText(source: "seed" | "user"): string {
  return source === "seed"
    ? "Built-in category — label follows FamilyFi updates, domains are yours to edit"
    : "Custom category — report-only, no UniFi policy";
}

export function enabledNoteText(enabled: boolean): string {
  return enabled
    ? "Checked on every sweep"
    : "Not checked — domains are kept, nothing is blocked or unblocked";
}

/** Coarse relative age, enough to judge whether a verdict is worth trusting. */
export function checkedAgo(checkedAt: string, now = Date.now()): string {
  const elapsed = now - new Date(checkedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** The active domain list a PATCH replaces, derived from what the UI is showing. */
export function activeDomainList(domains: UpstreamDomainRow[]): string[] {
  return domains.filter((domain) => !domain.removed).map((domain) => domain.domain);
}

export function suggestedMonogramFor(label: string): string {
  const letters = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
  return letters || "NEW";
}
