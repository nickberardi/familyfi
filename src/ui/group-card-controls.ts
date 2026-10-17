import { groupHeaderActions } from "@/lib/group-actions";
import type { GroupCardRun } from "@/lib/group-writes";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import type { ZoneAction } from "./CardActions";

/**
 * A group's one button, as every client draws it: Block, Unblock or Resume, with More time while
 * a timed block or unblock lasts. Each tap goes to `onRun` (`runGroupCardAction`); `enabled` is
 * false while the view is stale or a write is in flight. A single rule is paused from the group's
 * schedule on its page (`GroupSchedule`), never from its card.
 */
export function groupCardControls(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
  onRun: (tap: GroupCardRun) => void,
  enabled = true,
): { action: ZoneAction; more: ZoneAction | null } {
  const header = groupHeaderActions(group, rules, timezone, now);
  const asHeader = (spec: typeof header.action, strong: boolean): ZoneAction => ({
    label: spec.label,
    strong,
    disabled: !enabled,
    onPress: () => onRun({ kind: "header", run: spec.run }),
    testID: `group-action-${spec.run}-${group.id}`,
  });
  return { action: asHeader(header.action, true), more: header.more ? asHeader(header.more, false) : null };
}
