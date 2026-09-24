import { api } from "@/lib/api";
import { canPauseGroup } from "@/lib/display";
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
  run?: "pause" | "resume" | "extend";
};

export function groupActionSpecs(group: Group, surface: "phone" | "web"): GroupActionSpec[] {
  const href = group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`;
  const scheduleHref = `/rules#group-${group.id}`;
  const scheduleWord = "Rules";
  const detail: GroupActionSpec = {
    label: group.kind === "family" && group.familyRole === "adult" ? "View devices" : "Detail",
    href,
  };

  if (group.protected || (group.kind === "family" && group.familyRole === "adult")) {
    return surface === "phone" ? [] : [detail];
  }

  if (group.suspension.active) {
    return [
      { label: "Resume", strong: true, run: "resume" },
      { label: "Extend", run: "extend" },
      { label: scheduleWord, href: scheduleHref },
    ];
  }

  if (!canPauseGroup(group)) {
    const actions: GroupActionSpec[] = [{ label: scheduleWord, href: scheduleHref, strong: true }];
    if (surface === "web") actions.push(detail);
    return actions;
  }

  const pause: GroupActionSpec = { label: "Pause", strong: true, run: "pause" };
  if (surface === "phone") return [pause, { label: scheduleWord, href: scheduleHref }];
  return [pause, { label: scheduleWord, href: scheduleHref }, detail];
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
    resume: () => void mutate(() => api(`/api/v1/groups/${group.id}/resume`, { method: "POST" })),
    extend: () => openExtend(group),
  };
  return groupActionSpecs(group, surface).map(({ run, ...action }) =>
    run ? { ...action, onClick: handlers[run] } : action,
  );
}
