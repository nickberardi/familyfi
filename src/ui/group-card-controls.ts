import { groupHeaderActions, groupRuleActions, groupRulePause, type GroupLiftState } from "@/lib/group-actions";
import type { GroupCardRun } from "@/lib/group-writes";
import { internetRulesForGroup, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import type { ZoneAction } from "./CardActions";

export type ZoneControls = { action: ZoneAction | null; more: ZoneAction | null; paused: GroupLiftState | null };

/**
 * An open group card's buttons, as every client draws them: the header's Block, Unblock or Resume
 * with its More time, the internet area's Pause or Resume for this group, and the focused
 * category's (`focusedRule`, its label `focusedLabel`). Each tap goes to `onRun`
 * (`runGroupCardAction`); `enabled` is false while the view is stale or a write is in flight.
 */
export function groupCardControls(
  group: Group,
  rules: Rule[],
  focused: { rule: Rule | undefined; label: string; key: string } | null,
  timezone: string,
  now: Date,
  onRun: (tap: GroupCardRun) => void,
  enabled = true,
): { header: { action: ZoneAction; more: ZoneAction | null }; internet: ZoneControls; category: ZoneControls | null } {
  const header = groupHeaderActions(group, rules, timezone, now);
  const asHeader = (spec: typeof header.action, strong: boolean): ZoneAction => ({
    label: spec.label,
    strong,
    disabled: !enabled,
    onPress: () => onRun({ kind: "header", run: spec.run }),
    testID: `group-action-${spec.run}-${group.id}`,
  });

  const zone = (zoneRules: Rule[], name: string, key: string): ZoneControls => {
    const specs = groupRuleActions(group, zoneRules, now);
    const ruleIds = zoneRules.filter((rule) => rule.enabled).map((rule) => rule.id);
    const asZone = (spec: NonNullable<typeof specs.action>): ZoneAction => ({
      label: spec.label,
      disabled: !enabled,
      onPress: () => onRun({ kind: "rule", run: spec.run, ruleIds, name }),
      testID: `zone-action-${key}-${spec.run}-${group.id}`,
    });
    return {
      action: specs.action ? asZone(specs.action) : null,
      more: specs.more ? asZone(specs.more) : null,
      paused: groupRulePause(group, zoneRules, now),
    };
  };

  const internetRules = internetRulesForGroup(rules, group.id);
  const enabledInternet = internetRules.filter((rule) => rule.enabled);
  return {
    header: { action: asHeader(header.action, true), more: header.more ? asHeader(header.more, false) : null },
    internet: zone(internetRules, enabledInternet.length === 1 ? enabledInternet[0]!.name : "internet rules", "internet"),
    category: focused?.rule?.enabled ? zone([focused.rule], focused.label, focused.key) : null,
  };
}
