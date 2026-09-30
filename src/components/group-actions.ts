import { groupActionSpecs } from "@/lib/group-actions";
import { runGroupAction } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import type { Group } from "@/lib/types";
import type { CardAction } from "./GroupCard";

/** The card's actions for the web: pause and extend open their sheets; the rest write through the shared store. */
export function groupActions(
  group: Group,
  surface: "phone" | "web",
  openPause: (group: Group) => void,
  openExtend: (group: Group) => void,
  mutate: HouseholdStore["mutate"],
): CardAction[] {
  const handlers = {
    pause: () => openPause(group),
    resume: () => void runGroupAction(mutate, group, "resume"),
    extend: () => openExtend(group),
    allow: () => void runGroupAction(mutate, group, "allow"),
    disallow: () => void runGroupAction(mutate, group, "disallow"),
  };
  return groupActionSpecs(group, surface).map(({ run, ...action }) =>
    run ? { ...action, onClick: handlers[run] } : action,
  );
}
