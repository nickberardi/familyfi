import { groupAskLine } from "@/lib/group-ask";
import { groupHeaderActions } from "@/lib/group-actions";
import type { GroupCardRun } from "@/lib/group-writes";
import { groupLift, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import type { ZoneAction } from "./CardActions";

/**
 * A group's one button, as every client draws it: Block, Unblock or Resume (with a Block button
 * default, Block and Unblock act on that rule), with More time while
 * a timed block or unblock lasts, and, while a category, app or website rule blocks the group or is
 * lifted for it, a dropdown (`menu`): Block internet, and unblock or block again one rule for the group. Each
 * tap goes to `onRun` (`runGroupCardAction`); `enabled` is false while the view is stale or a write
 * is in flight. The group's page lists each rule with its own Pause or Resume (`GroupSchedule`), so its
 * dropdown (`pageMenu`) holds only Block internet. While a child's ask waits, its line (`ask`) opens
 * the answer sheet.
 */
export function groupCardControls(
  group: Group,
  rules: Rule[],
  timezone: string,
  now: Date,
  onRun: (tap: GroupCardRun) => void,
  enabled = true,
): { action: ZoneAction; more: ZoneAction | null; menu: ZoneAction[]; pageMenu: ZoneAction[]; ask: ZoneAction | null } {
  const header = groupHeaderActions(group, rules, timezone, now);
  const liftedUntil = (ruleIds: string[]) => {
    const rule = rules.find((candidate) => candidate.id === ruleIds[0]);
    return (rule && groupLift(rule, group.id, now)?.until) ?? null;
  };
  const asHeader = (spec: typeof header.action, strong: boolean): ZoneAction => ({
    label: spec.label,
    strong,
    disabled: !enabled,
    onPress: () =>
      // Putting the Block button rule back can be undone to when its lift ended.
      onRun({
        kind: "header",
        run: spec.run,
        ...(spec.ruleId ? { ruleId: spec.ruleId, name: spec.name ?? "" } : {}),
        ...(spec.run === "resumeRule" && spec.ruleId ? { liftedUntil: liftedUntil([spec.ruleId]) } : {}),
      }),
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
  const pageMenu = menu.filter((_, index) => header.menu[index]!.run === "blockInternet");
  const askLine = groupAskLine(group, rules, now);
  const ask: ZoneAction | null = askLine ? { label: askLine, disabled: !enabled, onPress: () => onRun({ kind: "ask" }), testID: `group-ask-${group.id}` } : null;
  return { action: asHeader(header.action, true), more: header.more ? asHeader(header.more, false) : null, menu, pageMenu, ask };
}
