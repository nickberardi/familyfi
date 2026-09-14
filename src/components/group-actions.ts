import { api } from "@/lib/api";
import { canPauseGroup } from "@/lib/display";
import type { Group } from "@/lib/types";
import type { CardAction } from "./GroupCard";
import type { useAppData } from "./AppDataProvider";

export function groupActions(
  group: Group,
  surface: "phone" | "web",
  openPause: (group: Group) => void,
  openExtend: (group: Group) => void,
  mutate: ReturnType<typeof useAppData>["mutate"],
): CardAction[] {
  const href = group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`;
  const scheduleHref = `/schedules#group-${group.id}`;
  const scheduleWord = group.kind === "family" ? "Bedtime" : "Schedule";
  const detail: CardAction = {
    label: group.kind === "family" && group.familyRole === "adult" ? "View devices" : "Detail",
    href,
  };

  if (group.protected || (group.kind === "family" && group.familyRole === "adult")) {
    return surface === "phone" ? [] : [detail];
  }

  if (group.suspension.active) {
    return [
      {
        label: "Resume",
        strong: true,
        onClick: () => void mutate(() => api(`/api/v1/groups/${group.id}/resume`, { method: "POST" })),
      },
      { label: "Extend", onClick: () => openExtend(group) },
      { label: scheduleWord, href: scheduleHref },
    ];
  }

  if (!canPauseGroup(group)) {
    const actions: CardAction[] = [{ label: scheduleWord, href: scheduleHref, strong: true }];
    if (surface === "web") actions.push(detail);
    return actions;
  }

  const pause: CardAction = { label: "Pause", strong: true, onClick: () => openPause(group) };
  if (surface === "phone") return [pause, { label: scheduleWord, href: scheduleHref }];
  return [pause, { label: scheduleWord, href: scheduleHref }, detail];
}
