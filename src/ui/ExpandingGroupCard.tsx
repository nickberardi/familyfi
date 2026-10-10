"use client";

import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { cardMarks, categorySlotStates, type CatalogNames } from "@/lib/category-marks";
import { groupActionSpecs } from "@/lib/group-actions";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import type { HouseholdStore } from "@/lib/household-store";
import { internetWindowsForGroup, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import type { UpstreamCategoryRow } from "@/lib/upstream";

import { ActionRow } from "./ActionRow";
import { CategoryZone } from "./CategoryZone";
import { GroupCardFrame } from "./GroupCardFrame";
import { GroupCardMarks } from "./GroupCardMarks";
import { InternetZone } from "./InternetZone";
import { InternetZoneFooter } from "./InternetZoneFooter";
import { EditRuleButton, type FilterTarget, type GroupRun } from "./StackedCards";

/**
 * A person or group of things as the companion's wide screens and group pages show it, mirroring
 * the web's `components/GroupCard.tsx` from the shared pieces. Closed, the card is its state and one row of
 * marks: the Internet mark, a divider, then its categories with FamilyFi's own rules first. Opening
 * it — the header, or any mark — shows the internet zone with its controls, one focused category,
 * the other categories, app rules, and Rules and Details. Marks open the filter sheet; Edit rule,
 * Edit internet rule and Rules open the rule editor and the group's rules.
 */
export function ExpandingGroupCard({
  group,
  rules,
  timezone,
  now,
  catalogNames,
  upstreamCategories,
  controlsEnabled,
  onAction,
  onFilter,
  onDetails,
  onAddApp,
  defaultOpen = false,
  mutate,
}: {
  group: Group;
  rules: Rule[];
  timezone: string;
  now: Date;
  catalogNames: CatalogNames;
  upstreamCategories: UpstreamCategoryRow[];
  /** False while the view is stale or a write for this group is in flight. */
  controlsEnabled: boolean;
  onAction: (run: GroupRun) => void;
  /** A mark's filter sheet: add or change its rule. */
  onFilter: (target: FilterTarget) => void;
  /** The group detail; absent on the detail itself. */
  onDetails?: () => void;
  /** Blocks another app for the group; the detail offers it, as the web's member page does. */
  onAddApp?: () => void;
  defaultOpen?: boolean;
  mutate: HouseholdStore["mutate"];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const windows = internetWindowsForGroup(rules, group.id, now);
  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, focus, more });
  const { focused } = marks;
  const openOn = (slot?: string) => {
    if (slot) setFocus(slot);
    setOpen(true);
  };
  // The zone's own controls, as the web's internet zone shows them; links come with their screens.
  const actions = groupActionSpecs(group, "phone").flatMap((action) =>
    action.run
      ? [
          {
            label: action.label,
            strong: action.strong,
            disabled: !controlsEnabled,
            onPress: () => onAction(action.run!),
            testID: `group-action-${action.run}-${group.id}`,
          },
        ]
      : [],
  );

  return (
    <GroupCardFrame
      group={group}
      windows={windows}
      timezone={timezone}
      now={now}
      open={open}
      onToggle={() => setOpen(!open)}
      testID={group.id}
    >
      {open ? (
        <View style={styles.zones}>
          <InternetZone
            group={group}
            windows={windows}
            timezone={timezone}
            now={now}
            actions={actions}
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
          {focused ? (
            <CategoryZone
              group={group}
              item={focused}
              rules={rules}
              timezone={timezone}
              now={now}
              onAddRule={() => onFilter({ category: focused.key })}
              editRule={focused.rule ? <EditRuleButton group={group} slot={focused.key} rule={focused.rule} /> : null}
            />
          ) : null}
        </View>
      ) : null}

      <GroupCardMarks
        group={group}
        windows={windows}
        timezone={timezone}
        now={now}
        rules={rules}
        catalogNames={catalogNames}
        open={open}
        marks={marks}
        more={more}
        onOpen={openOn}
        onToggleMore={() => setMore(!more)}
        onApp={(rule) => onFilter({ rule: rule.id })}
        onAddApp={onAddApp && controlsEnabled ? onAddApp : undefined}
      />

      {open ? (
        // The web's action row: the group's rules, and its detail where the card is not the detail itself.
        <ActionRow
          actions={[
            { label: GROUP_CARD_COPY.rules, href: `/rules?group=${group.id}`, testID: `group-rules-${group.id}` },
            ...(onDetails
              ? [
                  {
                    label: GROUP_CARD_COPY.details,
                    accessibilityLabel: GROUP_CARD_COPY.detailsLabel(group.name),
                    onPress: onDetails,
                    navigates: true,
                    testID: `group-details-${group.id}`,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </GroupCardFrame>
  );
}

const styles = StyleSheet.create({
  zones: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
});
