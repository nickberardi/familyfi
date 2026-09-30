import type { Group } from "./types";

/**
 * A card action as plain data: what `groupActions` shows, with `run` naming what a tap
 * does instead of carrying the callback. Every client shows these: the Expo app imports this
 * module, the native iOS app ports it, and `tests/fixtures/display-vectors.json` pins them.
 */
export type GroupActionSpec = {
  label: string;
  href?: string;
  strong?: boolean;
  run?: "pause" | "resume" | "extend" | "allow" | "disallow";
};

/**
 * The group's internet actions. Each names its scope — all internet on every device in
 * the group — so it is never mistaken for a category control.
 */
export function groupActionSpecs(group: Group, surface: "phone" | "web"): GroupActionSpec[] {
  const href = group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`;
  const rules: GroupActionSpec = { label: "Rules", href: `/rules?group=${group.id}` };
  const detail: GroupActionSpec = {
    label: group.kind === "family" && group.familyRole === "adult" ? "View devices" : "Detail",
    href,
  };

  if (group.suspension.active) {
    return [{ label: "Resume internet", strong: true, run: "resume" }, { label: "More time", run: "extend" }, rules];
  }
  if (group.access === "blocked") {
    // An internet rule's window is blocking: let the group online until it ends.
    return [{ label: "Allow internet now", strong: true, run: "allow" }, rules];
  }
  if (group.access === "allowed") {
    return [{ label: "Resume schedule", strong: true, run: "disallow" }, { label: "Pause all internet", run: "pause" }, rules];
  }
  const pause: GroupActionSpec = { label: "Pause all internet", strong: true, run: "pause" };
  return surface === "phone" ? [pause, rules] : [pause, rules, detail];
}

/** A group's built-in rule, "this group has internet": pausing it blocks all internet. */
export function internetRulePath(group: Pick<Group, "id">): string {
  return `/api/v1/groups/${group.id}/rules/internet`;
}
