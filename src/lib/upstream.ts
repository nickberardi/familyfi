/** Client-safe types and presentation for upstream categories. */

import { inRecurringWindow } from "@/lib/schedule";

type RuleScheduleShape = {
  enabled: boolean;
  days: number[];
  start: string | null;
  end: string | null;
};

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
 * - `on` — a FamilyFi rule is blocking it right now. Ours, and it wins.
 * - `blocked` — nothing of ours, but this group's resolver filters every domain.
 * - `partial` — the resolver filters some of the category's domains.
 * - `open` — we looked, and nothing is blocking it.
 * - `unknown` — we could not look, or have not yet.
 *
 * `open` and `unknown` are separate states even though neither is blocking, because
 * the styling now makes "not blocked" a green, positive claim. Collapsing them would
 * paint a category we never measured — or one whose resolver timed out — as verified
 * fine, which is the exact false assurance this whole feature exists to avoid.
 */
export type CategoryMarkState = "on" | "blocked" | "partial" | "open" | "unknown";

/**
 * Is this rule blocking the category *right now*?
 *
 * Not the same as enabled. A scheduled rule outside its window is switched on and
 * blocking nothing, so it must not be reported as the thing keeping a category shut —
 * and it must not hide a resolver that genuinely is.
 *
 * A malformed schedule evaluates to "not blocking" rather than throwing: a render must
 * not crash over bad stored times, and claiming a block we cannot verify is the worse
 * of the two failures.
 */
export function ruleActivelyBlocking(
  rule: { enabled: boolean; mode: "always" | "scheduled"; schedule: RuleScheduleShape } | undefined,
  timezone: string,
  now = new Date(),
): boolean {
  if (!rule?.enabled) return false;
  if (rule.mode === "always") return true;
  const { enabled, days, start, end } = rule.schedule;
  if (!enabled || !start || !end) return false;
  try {
    return inRecurringWindow(now, { enabled, days, start, end }, timezone);
  } catch {
    return false;
  }
}

/**
 * The precedence rule: a FamilyFi rule that is *actively blocking* is the state shown.
 * Otherwise the mark falls back to the DNS-derived verdict — the downstream status.
 *
 * So a rule that is off, or on but outside its schedule, does not win. It is blocking
 * nothing at this moment, and reporting it as the blocker would both overstate what
 * FamilyFi is doing and hide what the resolver is actually doing.
 *
 * `check` must already be resolved for this card's group with `effectiveCheck`, which
 * is what makes a mark on a kid with their own resolver report that resolver rather
 * than the household's.
 *
 * A verdict of `unknown`, and never having checked at all, both land on `unknown`: in
 * both cases the resolver's answer is missing, and the mark must not imply one.
 */
export function categoryMarkState(
  activelyBlocking: boolean,
  check: UpstreamCheckRow | null,
): CategoryMarkState {
  if (activelyBlocking) return "on";
  if (check?.verdict === "blocked") return "blocked";
  if (check?.verdict === "partial") return "partial";
  if (check?.verdict === "open") return "open";
  return "unknown";
}

/**
 * An app mark has no DNS side — an app rule is the only thing FamilyFi knows about —
 * so it reports `on` or `unknown`, never the green `open`. Nobody measured the app.
 */
export function appMarkState(activelyBlocking: boolean): CategoryMarkState {
  return activelyBlocking ? "on" : "unknown";
}

/**
 * The word under a mark. Both blocking states read "blocked" on purpose: the question
 * a parent is asking is whether the thing is shut, and the colour answers *who* shut
 * it. Nothing blocking gets no word at all — an empty label is quieter than "Off", and
 * the circle's fill already says it.
 */
export function categoryMarkWord(state: CategoryMarkState): string {
  switch (state) {
    case "on":
    case "blocked":
      return "blocked";
    case "partial":
      return "partial";
    default:
      return "";
  }
}

type MarkStyle = { fill: string; ink: string };

/**
 * Mark colours, kept here beside the words so the two cannot drift.
 *
 * Red is FamilyFi's own block, matching the Turn off control in the sheet. Purple is
 * the resolver's — solid when it blocks the whole list, a tint when it blocks part of
 * it. Green is a measured all-clear. Neutral is "we do not know", and it is
 * deliberately not green: unmeasured must never read as verified.
 */
const MARK: Record<CategoryMarkState, MarkStyle> = {
  on: { fill: "var(--ff-danger-fill)", ink: "var(--ff-danger)" },
  blocked: { fill: "var(--ff-upstream-fill)", ink: "var(--ff-ink-on-fill)" },
  partial: { fill: "var(--ff-upstream-tint)", ink: "var(--ff-upstream-ink)" },
  open: { fill: "var(--ff-on-tint)", ink: "var(--ff-on-ink)" },
  unknown: { fill: "var(--ff-field)", ink: "var(--ff-ink-2)" },
};

export function categoryMarkStyle(state: CategoryMarkState): MarkStyle {
  return MARK[state];
}

/**
 * The accessible name, which has room to say what the word cannot.
 *
 * `open` and `unknown` differ in the mark's colour but read close in words, because
 * the claim we can make about FamilyFi is the same either way. `unknown` says so
 * explicitly rather than asserting the category is clear.
 */
export function categoryMarkLabel(label: string, state: CategoryMarkState): string {
  switch (state) {
    case "on":
      return `${label} blocked by FamilyFi`;
    case "blocked":
      return `${label} already blocked by DNS`;
    case "partial":
      return `${label} partially blocked by DNS`;
    case "open":
      return `${label} not blocked`;
    default:
      return `${label} not blocked by FamilyFi`;
  }
}

/** Finds the upstream category that corresponds to a curated DPI slot, by slug. */
export function upstreamCategoryForSlot(
  categories: UpstreamCategoryRow[],
  slot: string,
): UpstreamCategoryRow | undefined {
  return categories.find((category) => category.slug === slot);
}
