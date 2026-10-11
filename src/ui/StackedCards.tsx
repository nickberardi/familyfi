"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { categoryRuleItems, categorySlotStates, stackedCardMarks, type CatalogNames } from "@/lib/category-marks";
import { cardNoteLine } from "@/lib/display";
import { groupActionSpecs, type GroupActionSpec } from "@/lib/group-actions";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import type { HouseholdStore } from "@/lib/household-store";
import { ruleActionSpecs, ruleGroupStateLines } from "@/lib/rule-actions";
import { ruleHref, ruleOpenLabel } from "@/lib/rule-list";
import { internetWindowsForGroup, ruleBlocksLabel, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import type { UpstreamCategoryRow } from "@/lib/upstream";

import { ActionRow, type CardAction } from "./ActionRow";
import { CategoryZone } from "./CategoryZone";
import { GroupCardMarks } from "./GroupCardMarks";
import { InternetZone } from "./InternetZone";
import { InternetZoneFooter } from "./InternetZoneFooter";
import { RuleBar } from "./RuleBar";
import { RuleFacts, type RuleCardAction } from "./RuleCard";
import { useUI } from "./UIContext";

/**
 * The open cards of the companion's stacks (familyfi-mobile's Family, Things and Rules on a phone):
 * what goes under a card's head, and the actions at its foot. The stack, its head and its motion
 * are the app's; the web lists its cards whole and draws none of these.
 */

/** What a mark opens in the filter sheet: a category by its key, or an app rule by its id. */
export type FilterTarget = { category: string } | { rule: string };

export type GroupRun = NonNullable<GroupActionSpec["run"]>;

/** A focused category's way to its rule's editor, scoped to the card's group. */
export function EditRuleButton({
  group,
  slot,
  rule,
}: {
  group: Pick<Group, "id">;
  slot: string;
  rule: Pick<Rule, "id">;
}) {
  const ui = useUI();
  return (
    <ui.Link href={`/rules/${rule.id}?group=${group.id}`} testID={`edit-rule-${slot}-${group.id}`}>
      <View style={[styles.editRule, { backgroundColor: ui.color("card"), borderColor: ui.color("control-line") }]}>
        <Text style={{ fontFamily: ui.font, fontSize: 14, fontWeight: "600", color: ui.color("accent") }}>
          {GROUP_CARD_COPY.editRule}
        </Text>
      </View>
    </ui.Link>
  );
}

/**
 * An open group card in the stack: its note, then what limits it, each rule folded to a line that
 * opens to its timeline (all internet, or its presets with no rule; each category FamilyFi blocks;
 * each one the resolver blocks), then the other categories and app rules, which open their sheets.
 */
export function GroupStackBody({
  group,
  rules,
  timezone,
  now,
  catalogNames,
  upstreamCategories,
  controlsEnabled,
  mutate,
  onFilter,
}: {
  group: Group;
  rules: Rule[];
  timezone: string;
  now: Date;
  catalogNames: CatalogNames;
  upstreamCategories: UpstreamCategoryRow[];
  /** False while the view is stale or a write for this group is in flight. */
  controlsEnabled: boolean;
  mutate: HouseholdStore["mutate"];
  /** A category's or app rule's filter sheet: add or change its rule. */
  onFilter: (target: FilterTarget) => void;
}) {
  const ui = useUI();
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState(false);
  const windows = internetWindowsForGroup(rules, group.id, now);
  const slots = categorySlotStates(group, rules, upstreamCategories, timezone);
  const { ruled, upstream, marks } = stackedCardMarks(
    slots,
    more,
    categoryRuleItems(group.id, rules, slots, catalogNames, timezone),
  );
  const fold = (key: string) => ({
    open: Boolean(folds[key]),
    onToggle: () => setFolds((current) => ({ ...current, [key]: !current[key] })),
    testID: `fold-${key}-${group.id}`,
  });
  return (
    <View>
      <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-3") }]}>
        {cardNoteLine(group, windows)}
      </Text>
      <View style={styles.zones}>
        <InternetZone
          group={group}
          windows={windows}
          timezone={timezone}
          now={now}
          actions={[]}
          fold={fold("internet")}
          footer={
            <InternetZoneFooter
              group={group}
              windows={windows}
              timezone={timezone}
              now={now}
              mutate={mutate}
              disabled={!controlsEnabled}
            />
          }
        />
        {ruled.map((item) => (
          <CategoryZone
            key={item.key}
            group={group}
            item={item}
            rules={rules}
            timezone={timezone}
            now={now}
            fold={fold(item.key)}
            onAddRule={() => onFilter({ category: item.key })}
            editRule={item.rule ? <EditRuleButton group={group} slot={item.key} rule={item.rule} /> : null}
          />
        ))}
        {upstream.map((item) => (
          <CategoryZone
            key={item.key}
            group={group}
            item={item}
            rules={rules}
            timezone={timezone}
            now={now}
            onAddRule={() => onFilter({ category: item.key })}
            editRule={null}
          />
        ))}
      </View>
      <GroupCardMarks
        group={group}
        windows={windows}
        timezone={timezone}
        now={now}
        rules={rules}
        catalogNames={catalogNames}
        open
        marks={marks}
        more={more}
        onOpen={(slot) => (slot ? onFilter({ category: slot }) : undefined)}
        onToggleMore={() => setMore(!more)}
        onApp={(rule) => onFilter({ rule: rule.id })}
      />
    </View>
  );
}

/** An open group card's foot: the group's internet actions, its rules and its detail. */
export function GroupStackActions({
  group,
  controlsEnabled,
  onAction,
  onDetails,
}: {
  group: Group;
  controlsEnabled: boolean;
  onAction: (run: GroupRun) => void;
  onDetails: () => void;
}) {
  const actions: CardAction[] = groupActionSpecs(group, "phone").map((action) =>
    action.run
      ? {
          label: action.label,
          strong: action.strong,
          disabled: !controlsEnabled,
          onPress: () => onAction(action.run!),
          testID: `group-action-${action.run}-${group.id}`,
        }
      : { label: action.label, href: action.href, testID: `group-rules-${group.id}` },
  );
  actions.push({
    label: GROUP_CARD_COPY.details,
    accessibilityLabel: GROUP_CARD_COPY.detailsLabel(group.name),
    onPress: onDetails,
    navigates: true,
    testID: `group-details-${group.id}`,
  });
  return <ActionRow actions={actions} />;
}

/** An open rule card in the stack: its windows on a taller bar, then what it blocks, when and for whom. */
export function RuleStackBody({
  rule,
  groups,
  networks,
  catalogNames,
  timezone,
  now,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  networks: { id: string; name: string }[];
  catalogNames: CatalogNames;
  timezone: string;
  now: Date;
}) {
  const ui = useUI();
  const groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name]));
  return (
    <View style={styles.ruleBody}>
      <RuleBar rule={rule} height={22} />
      <RuleFacts rule={rule} groups={groups} networks={networks} blocks={ruleBlocksLabel(rule, catalogNames)} />
      {ruleGroupStateLines(rule, groupNames, timezone, now).map((line) => (
        <Text key={line} style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color("ink-2") }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** An open rule card's foot: what can be done about it now, then the way to its page. */
export function RuleStackActions({
  rule,
  timezone,
  now,
  disabled = false,
  onAction,
}: {
  rule: Rule;
  timezone: string;
  now: Date;
  /** True while the household is stale, so nothing is sent. */
  disabled?: boolean;
  onAction: (action: RuleCardAction) => void;
}) {
  return (
    <ActionRow
      actions={[
        ...ruleActionSpecs(rule, timezone, now).map((action) => ({
          label: action.label,
          strong: action.strong,
          disabled,
          onPress: () => onAction(action.run),
          testID: `rule-action-${action.run}-${rule.id}`,
        })),
        { label: ruleOpenLabel(rule), href: ruleHref(rule), testID: `rule-open-${rule.id}` },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  editRule: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  note: { paddingHorizontal: 18, paddingBottom: 10, fontSize: 14, lineHeight: 20 },
  zones: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
  ruleBody: { gap: 4, paddingHorizontal: 18, paddingTop: 2 },
});
