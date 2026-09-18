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
  /** The group this verdict was measured for. Null is the household default. */
  groupId: string | null;
};

/** What a card needs to know to resolve its own verdict. */
export type UpstreamGroupContext = {
  id: string;
  /** Null means this group reads the household default. */
  dohOverrideUrl: string | null;
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
  /** Every measured verdict. Resolve with `effectiveCheck`, never by indexing. */
  checks: UpstreamCheckRow[];
};

export type UpstreamResolverSettings = {
  configured: boolean;
  /** The endpoint in full. Configuration, not a credential — see resolver-settings.ts. */
  url: string | null;
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
 * The verdict for a card, in that card's own resolver context.
 *
 * A group with its own endpoint is filtered differently from the rest of the house, so
 * its card must show its own answer wherever it appears — beside a sibling on Family,
 * on its own detail page, anywhere. A group without an override reads the household
 * default. Passing no group asks the household question.
 *
 * This is the only place that rule lives. Read a row out of `checks` directly and a
 * card will sooner or later show someone else's answer.
 */
export function effectiveCheck(
  checks: UpstreamCheckRow[],
  group?: UpstreamGroupContext | null,
): UpstreamCheckRow | null {
  if (group?.dohOverrideUrl) {
    // Measured for this group. Absent only until the first sweep after the override.
    return checks.find((check) => check.groupId === group.id) ?? null;
  }
  return checks.find((check) => check.groupId === null) ?? null;
}

/** Whether a card is reporting its own endpoint rather than the household's. */
export function usesOwnResolver(group?: UpstreamGroupContext | null): boolean {
  return Boolean(group?.dohOverrideUrl);
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

/**
 * What a category mark on a group card shows.
 *
 * - `on` — a FamilyFi rule is blocking it. Ours, and it wins.
 * - `blocked` — nothing of ours, but this group's resolver filters it.
 * - `partial` — the resolver filters some of the category's domains.
 * - `off` — nothing is known to be blocking it.
 */
export type CategoryMarkState = "on" | "blocked" | "partial" | "off";

/**
 * The precedence rule: an existing, enabled FamilyFi rule is the state shown.
 * Otherwise the mark falls back to the DNS-derived verdict.
 *
 * A rule that exists but is turned off does not win — it is not blocking anything, so
 * the honest answer is whatever the resolver is doing.
 *
 * `check` must already be resolved for this card's group with `effectiveCheck`, which
 * is what makes a mark on a kid with their own resolver report that resolver rather
 * than the household's.
 *
 * `unknown` and "never checked" both land on `off`. The mark answers "is something
 * blocking this", and when we could not look the truthful answer about *FamilyFi* is
 * still no; the sheet carries the nuance.
 */
export function categoryMarkState(
  ruleEnabled: boolean,
  check: UpstreamCheckRow | null,
): CategoryMarkState {
  if (ruleEnabled) return "on";
  if (check?.verdict === "blocked") return "blocked";
  if (check?.verdict === "partial") return "partial";
  return "off";
}

/** The word under a mark. Short by necessity — the sheet explains. */
export function categoryMarkWord(state: CategoryMarkState): string {
  return state === "on" ? "On" : state === "blocked" ? "DNS" : state === "partial" ? "Part" : "Off";
}

/** The accessible name, which has room to say what the word cannot. */
export function categoryMarkLabel(label: string, state: CategoryMarkState): string {
  switch (state) {
    case "on":
      return `${label} blocked by FamilyFi`;
    case "blocked":
      return `${label} already blocked by DNS`;
    case "partial":
      return `${label} partially blocked by DNS`;
    default:
      return `${label} not blocked`;
  }
}

/** Finds the upstream category that corresponds to a curated DPI slot, by slug. */
export function upstreamCategoryForSlot(
  categories: UpstreamCategoryRow[],
  slot: string,
): UpstreamCategoryRow | undefined {
  return categories.find((category) => category.slug === slot);
}
