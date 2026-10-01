/**
 * The sheet behind a category or app mark, as every client shows it.
 *
 * Four states, following the same precedence as the mark: a FamilyFi policy we own comes first,
 * and when there is none the sheet reports what this group's own resolver is doing — already
 * blocked, partially blocked, or nothing at all.
 *
 * The upstream states are reports, not controls. FamilyFi did not block it and cannot unblock it,
 * so the only action offered is still to create our own policy, which is worth doing when a
 * household wants a schedule or wants it to survive a resolver change.
 */
import type { ApiRequest } from "./api-client";
import type { CategorySheetState } from "./category-marks";
import { daysLabel, windowTimes } from "./display";
import type { Group } from "./types";
import { checkedAgo } from "./upstream";

/** What the sheet's main button does: turn the rule off, turn it on, create one, or link to a Websites rule. */
export type FilterSheetAction = "turnOff" | "enable" | "create" | "websites";

export function filterSheetCopy(group: Pick<Group, "id" | "name">, state: CategorySheetState, now = Date.now()) {
  /**
   * Two different questions, deliberately kept apart.
   *
   * `owned` decides which *control* to offer, and turns on rule existence: a scheduled rule sitting
   * outside its window still needs a Turn off button, not an offer to create the policy it already
   * has.
   *
   * `on` decides what the sheet *reports*, and is true only while the rule is actually blocking.
   * Outside its window the honest report is whatever the resolver is doing.
   */
  const owned = Boolean(state.rule?.enabled);
  const on = state.kind === "category" ? state.activelyBlocking : owned;
  const upstream = state.kind === "category" ? state.upstream : null;
  /** On but out of window: say so, rather than implying no policy exists. */
  const scheduledIdle = owned && !on;
  const upstreamBlocked = !on && upstream?.verdict === "blocked";
  const upstreamPartial = !on && upstream?.verdict === "partial";
  const measured = upstream ? ` Checked ${checkedAgo(upstream.checkedAt, now)}.` : "";

  const heading = on
    ? `${state.name} · blocked`
    : scheduledIdle && upstreamBlocked
      ? `Already blocked (DNS)`
      : scheduledIdle
        ? `${state.name} · scheduled, not now`
        : upstreamBlocked
          ? `Already blocked (DNS)`
          : upstreamPartial
            ? `Partially blocked (DNS)`
            : `Nothing's blocking ${state.name} yet`;

  /** UniFi has no category for it, so FamilyFi can only block its websites. */
  const websitesOnly = state.kind === "category" && state.categoryId === null && !state.rule;
  const shared = (state.rule?.groupIds.length ?? 0) > 1;
  const body = on
    ? `Its own policy, its own controls — scoped to ${state.name} only. Everything else stays on.${
        shared ? ` Turning it off turns “${state.rule!.name}” off for every group it covers.` : ""
      }`
    : scheduledIdle
      ? `${state.name} has a FamilyFi policy on a schedule, and this is not one of its hours.${
          upstreamBlocked ? " Its DNS resolver is blocking it anyway right now." : ""
        }`
      : upstreamBlocked
        ? `${group.name}'s DNS resolver already blocks every ${state.name} domain we test.${measured} FamilyFi is not doing it, so it cannot schedule or pause it — create a policy if you want that.`
        : upstreamPartial
          ? `${group.name}'s DNS resolver blocks ${upstream!.blockedCount} of ${upstream!.totalCount} ${state.name} domains we test.${measured} A FamilyFi policy would cover the rest.`
          : "Create a FamilyFi policy? Schedulable afterward, same as Internet.";
  const domainCount = state.kind === "category" ? state.domains.length : 0;
  const websitesNote = `UniFi has no ${state.name} category, so FamilyFi can't block it as one. ${
    domainCount
      ? `A Websites rule can block the ${domainCount} ${domainCount === 1 ? "website" : "websites"} this category checks.`
      : "Add its websites on the Categories page, or block them with a Websites rule."
  }`;
  const action: FilterSheetAction = websitesOnly ? "websites" : owned ? "turnOff" : state.rule ? "enable" : "create";

  return {
    heading,
    body: websitesOnly ? websitesNote : body,
    /** A scheduled rule's windows, one line each. */
    windows: state.rule?.mode === "scheduled" ? state.rule.windows.map((window) => `${window.name ? `${window.name} · ` : ""}${windowTimes(window.start, window.end)} · ${daysLabel(window.days)}`) : [],
    action,
    actionLabel: websitesOnly ? "Block its websites" : owned ? "Turn off" : "Create policy",
    /** The link to the rule editor, under the button. */
    editLabel: state.rule ? "Edit rule and schedule" : "Schedule it instead",
    cancel: "Cancel",
  };
}

/** The name a rule created from the sheet gets. */
export function filterRuleName(group: Pick<Group, "name">, state: Pick<CategorySheetState, "name">): string {
  return `${state.name} for ${group.name}`.slice(0, 60);
}

/**
 * The sheet's write: turn the rule off, turn it on, or create an always-on category rule for this
 * group, through the household store's `mutate`, which reports a failure itself. There is nothing
 * to send for a category UniFi cannot block.
 */
export async function applyFilterAction(
  mutate: (run: (request: ApiRequest) => Promise<unknown>) => Promise<unknown>,
  group: Pick<Group, "id" | "name">,
  state: CategorySheetState,
  action: Exclude<FilterSheetAction, "websites">,
) {
  const rule = state.rule;
  if (action === "turnOff" && rule) return mutate((send) => send(`/api/v1/rules/${rule.id}/off`, { method: "POST", body: {} }));
  if (action === "enable" && rule) return mutate((send) => send(`/api/v1/rules/${rule.id}`, { method: "PATCH", body: { enabled: true } }));
  if (action === "create" && state.kind === "category" && !rule && state.categoryId !== null) {
    const categoryId = state.categoryId;
    return mutate((send) =>
      send("/api/v1/rules", {
        method: "POST",
        body: { name: filterRuleName(group, state), kind: "category", scope: "group", groupIds: [group.id], targetIds: [categoryId], mode: "always" },
      }),
    );
  }
  throw new Error("Nothing to create.");
}
