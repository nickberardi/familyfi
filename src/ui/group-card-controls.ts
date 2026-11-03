import { groupHeaderActions } from "@/lib/group-actions";
import type { GroupCardRun } from "@/lib/group-writes";
import { groupLift, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import type { ZoneAction } from "./CardActions";

/**
 * A group's one button, as every client draws it: Block, Unblock or Resume, with More time while
 * a timed block or unblock lasts, and, while a category, app or website rule blocks the group or is
 * lifted for it, a dropdown (`menu`): Block internet, and unblock or block again one rule for the group. Each
 * tap goes to `onRun` (`runGroupCardAction`); `enabled` is false while the view is stale or a write
 * is in flight. On the group's page, its schedule (`GroupSchedule`) pauses each rule instead.
 */
export function groupCardControls(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
  onRun: (tap: GroupCardRun) => void,
  enabled = true,
): { action: ZoneAction; more: ZoneAction | null; menu: ZoneAction[] } {
  const header = groupHeaderActions(group, rules, timezone, now);
  const liftedUntil = (ruleIds: string[]) => {
    const rule = rules.find((candidate) => candidate.id === ruleIds[0]);
    return (rule && groupLift(rule, group.id, now)?.until) ?? null;
  };
  const asHeader = (spec: typeof header.action, strong: boolean): ZoneAction => ({
    label: spec.label,
    strong,
    disabled: !enabled,
    onPress: () => onRun({ kind: "header", run: spec.run }),
    testID: `group-action-${spec.run}-${group.id}`,
  });
  const menu = header.menu.map(
    (item): ZoneAction => ({
      label: item.label,
      disabled: !enabled,
      onPress: () =>
        onRun(item.run === "blockInternet" ? { kind: "header", run: "block" } : { kind: "rule", run: item.run, ruleIds: item.ruleIds, name: item.name, wording: "unblock", ...(item.run === "resume" ? { liftedUntil: liftedUntil(item.ruleIds) } : {}) }),
      testID: item.run === "blockInternet" ? `group-menu-block-${group.id}` : `group-menu-${item.run}-${item.ruleIds.join("-")}-${group.id}`,
    }),
  );
  return { action: asHeader(header.action, true), more: header.more ? asHeader(header.more, false) : null, menu };
}
