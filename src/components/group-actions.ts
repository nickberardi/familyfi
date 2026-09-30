import { api } from "@/lib/api";
import { groupActionSpecs, internetRulePath } from "@/lib/group-actions";
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
