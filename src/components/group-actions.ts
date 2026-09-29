import { api } from "@/lib/api";
import type { Group } from "@/lib/types";
import type { CardAction } from "./GroupCard";
import type { useAppData } from "./AppDataProvider";

/**
 * A card action as plain data: what `groupActions` shows, with `run` naming what a tap
 * does instead of carrying the callback. The native iOS app ports this, and
 * `tests/fixtures/display-vectors.json` pins it.
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

export function groupActions(
  group: Group,
  surface: "phone" | "web",
  openPause: (group: Group) => void,
  openExtend: (group: Group) => void,
  mutate: ReturnType<typeof useAppData>["mutate"],
): CardAction[] {
  const handlers = {
    pause: () => openPause(group),
    resume: () => void mutate(() => api(`${internetRulePath(group)}/resume`, { method: "POST" })),
    extend: () => openExtend(group),
    allow: () => void mutate(() => api(`${internetRulePath(group)}/allow`, { method: "POST", body: "{}" })),
    disallow: () => void mutate(() => api(`${internetRulePath(group)}/disallow`, { method: "POST" })),
  };
  return groupActionSpecs(group, surface).map(({ run, ...action }) =>
    run ? { ...action, onClick: handlers[run] } : action,
  );
}
