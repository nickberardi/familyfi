/**
 * A group's category and app marks, as every client's card and group detail show them.
 *
 * A mark shows whichever thing is actually blocking the category. A FamilyFi rule blocking right
 * now wins and renders in red, the same red as the sheet's Turn off; otherwise the mark falls back
 * to what this group's own resolver reports, in purple. The colour answers *who*, which is why
 * neither borrows the accent. Green is a measured all-clear and grey is "we have not looked" —
 * never the same thing.
 */
import type { ApiRequest } from "./api-client";
import { windowTimes } from "./display";
import type { IconName } from "./icons";
import { CURATED_CATEGORY_SLOTS, categoryRuleForSlot, type CuratedCategorySlot, type Rule } from "./rules";
import type { Group } from "./types";
import {
  categoryMarkState,
  effectiveCheck,
  ruleActivelyBlocking,
  upstreamCategoryForSlot,
  type CategoryMarkState,
  type UpstreamCategoryRow,
  type UpstreamCheckRow,
} from "./upstream";
import { upstreamCategoryIcon } from "./upstream-domains";

/**
 * A household category as a group sees it: its rule, its resolver's verdict and its mark state.
 * `slot` is the UniFi DPI category FamilyFi can block it with; a category without one (AI, Dating,
 * one the household made) can only be reported, or blocked by its websites.
 */
export type CategorySlotState = {
  key: string;
  label: string;
  slot: CuratedCategorySlot | undefined;
  /** The seeded category's glyph, when it has no DPI slot to draw. */
  icon: IconName | undefined;
  monogram: string;
  /** The domains the resolver checks for it, for a Websites rule. */
  domains: string[];
  rule: Rule | undefined;
  check: ReturnType<typeof effectiveCheck>;
  blocking: boolean;
  state: CategoryMarkState;
};

/** Every household category: the ones UniFi can block first, then the rest as listed. */
export function categorySlotStates(
  group: Group,
  rules: Rule[],
  upstreamCategories: UpstreamCategoryRow[],
  timezone: string,
): CategorySlotState[] {
  const seededSlot = (row: UpstreamCategoryRow) =>
    row.source === "seed" ? CURATED_CATEGORY_SLOTS.find((slot) => slot.slot === row.slug) : undefined;
  const mapped = CURATED_CATEGORY_SLOTS.map((slot) => {
    const upstream = upstreamCategoryForSlot(upstreamCategories, slot.slot);
    return { slot, upstream: upstream && seededSlot(upstream) ? upstream : undefined };
  });
  const others = upstreamCategories.filter((row) => !seededSlot(row)).map((row) => ({ slot: undefined, upstream: row }));
  return [...mapped, ...others].map(({ slot, upstream }) => {
    const rule = slot ? categoryRuleForSlot(rules, group.id, slot.categoryId) : undefined;
    // A rule blocking *right now* wins; otherwise this group's resolver decides.
    const check = upstream ? effectiveCheck(upstream.checks, group) : null;
    const blocking = ruleActivelyBlocking(rule, timezone);
    return {
      key: slot?.slot ?? upstream!.slug,
      label: slot?.label ?? upstream!.label,
      slot,
      icon: upstream ? upstreamCategoryIcon(upstream.slug, upstream.source) : undefined,
      monogram: upstream?.monogram ?? slot!.label.slice(0, 3).toUpperCase(),
      domains: upstream ? upstream.domains.filter((domain) => !domain.removed).map((domain) => domain.domain) : [],
      rule,
      check,
      blocking,
      state: categoryMarkState(blocking, check),
    };
  });
}

/** What a category or app mark opens: its rule, or a way to add one. */
export type CategorySheetState =
  | {
      kind: "category";
      name: string;
      /** The UniFi DPI category, or null when UniFi has none for it (AI, Dating, …). */
      categoryId: number | null;
      /** The domains its checks use; a Websites rule can block these instead. */
      domains: string[];
      rule: Rule | undefined;
      /** Already resolved for this card's group; null when nothing has been measured. */
      upstream: UpstreamCheckRow | null;
      /** Whether the rule is blocking at this moment, not merely switched on. */
      activelyBlocking: boolean;
    }
  | { kind: "app"; name: string; rule: Rule };

/** The sheet a category's mark opens. */
export function categorySheet(item: CategorySlotState): CategorySheetState {
  return {
    kind: "category",
    name: item.label,
    categoryId: item.slot ? item.slot.categoryId : null,
    domains: item.domains,
    rule: item.rule,
    upstream: item.check,
    activelyBlocking: item.blocking,
  };
}

/** Category marks on a closed card, before "More". */
export const CLOSED_MARKS = 4;
/** Other-category marks on an open card, before "More". */
export const OPEN_MARKS = 5;

/**
 * A card's marks: FamilyFi's own rules first, then the resolver's verdicts. Open, one category is
 * focused (the one tapped, or the first) and the rest are "Other categories"; either way the row
 * shows a few before "More".
 */
export function cardMarks(slots: CategorySlotState[], { open, focus, more }: { open: boolean; focus: string | null; more: boolean }) {
  const ordered = [...slots.filter((item) => item.rule?.enabled), ...slots.filter((item) => !item.rule?.enabled)];
  const focused = ordered.find((item) => item.key === focus) ?? ordered[0];
  const pool = open ? ordered.filter((item) => item !== focused) : ordered;
  const cap = open ? OPEN_MARKS : CLOSED_MARKS;
  return {
    ordered,
    focused: open ? focused : undefined,
    shown: more ? pool : pool.slice(0, cap),
    hidden: pool.length > cap ? pool.length - cap : 0,
  };
}

/** The "More" mark's words. */
export function moreMarkLabels(more: boolean, total: number, hidden: number) {
  return {
    accessibilityLabel: more ? "Show fewer categories" : `Show all ${total} categories`,
    badge: more ? "–" : `+${hidden}`,
    word: more ? "Fewer" : "More",
  };
}

/** What the resolver says about a category with no rule. */
export const UPSTREAM_VERDICT_WORDS: Record<CategoryMarkState, string> = {
  blocked: "blocked upstream",
  partial: "partly blocked upstream",
  open: "open upstream",
  unknown: "not checked",
  rule: "",
};

/** When a category rule blocks it, in a sentence. */
export function categoryRuleWhen(rule: Pick<Rule, "mode" | "windows">): string {
  return rule.mode === "always"
    ? "Always blocked by FamilyFi."
    : `Blocked ${rule.windows.map((window) => windowTimes(window.start, window.end)).join(" and ")}.`;
}

/** The names UniFi gives its DPI categories and applications, keyed `category:<id>` and `app:<id>`. */
export type CatalogNames = Map<string, string>;

/**
 * What a card's marks need beyond the household: the DPI catalog's names (for app rules) and the
 * resolver's categories with every verdict, from which each card resolves its own — two kids on
 * different resolvers show different answers on the same page. A list that fails to load is empty.
 */
export async function loadFilterCatalog(request: ApiRequest): Promise<{ catalogNames: CatalogNames; upstreamCategories: UpstreamCategoryRow[] }> {
  type Item = { id: number | string; name: string };
  const [categories, applications, upstream] = await Promise.all([
    request<{ categories: Item[] }>("/api/v1/dpi/categories").catch(() => ({ categories: [] as Item[] })),
    request<{ applications: Item[] }>("/api/v1/dpi/applications").catch(() => ({ applications: [] as Item[] })),
    request<{ categories: UpstreamCategoryRow[] }>("/api/v1/upstream/categories").catch(() => ({ categories: [] as UpstreamCategoryRow[] })),
  ]);
  const catalogNames: CatalogNames = new Map();
  for (const item of categories.categories) catalogNames.set(`category:${item.id}`, item.name);
  for (const item of applications.applications) catalogNames.set(`app:${item.id}`, item.name);
  return { catalogNames, upstreamCategories: upstream.categories };
}
