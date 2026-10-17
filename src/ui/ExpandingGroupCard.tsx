"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { cardMarks, categorySlotStates, type CatalogNames } from "@/lib/category-marks";
import { cardNoteLine } from "@/lib/display";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import type { GroupCardRun } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { internetRulesForGroup, internetWindowsForGroup, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import type { UpstreamCategoryRow } from "@/lib/upstream";

import { ActionRow } from "./ActionRow";
import { groupCardControls } from "./group-card-controls";
import { GroupCardFrame } from "./GroupCardFrame";
import { GroupCardMarks } from "./GroupCardMarks";
import { GROUP_SCHEDULE_COPY, GroupSchedule, ScheduleLink } from "./GroupSchedule";
import { InternetPresets } from "./InternetPresets";
import { useUI } from "./UIContext";

/** What a mark opens in the filter sheet: a category by its key, or an app rule by its id. */
export type FilterTarget = { category: string } | { rule: string };

/**
 * A person or group of things as the companion's wide screens and group pages show it, mirroring
 * the web's `components/GroupCard.tsx` from the shared pieces. Closed, the card is its state and one row of
 * marks: the Internet mark, a divider, then its categories with FamilyFi's own rules first. Opening
 * it — the header, or any mark — puts the group's Block, Unblock or Resume in the header's corner
 * and shows `ExpandedGroupBody` and `GroupCardLinks`, whose Show less closes it. A phone's stacked
 * card opens to the same two under its own head, which draws the header's button itself.
 */
export function ExpandingGroupCard({
  group,
  rules,
  timezone,
  now,
  catalogNames,
  upstreamCategories,
  controlsEnabled,
  onRun,
  onFilter,
  onDetails,
  onAddApp,
  defaultOpen = false,
  mutate,
}: ExpandedGroupProps & {
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [more, setMore] = useState(false);
  const windows = internetWindowsForGroup(rules, group.id, now);
  const shared = { group, rules, timezone, now, catalogNames, upstreamCategories, controlsEnabled, onRun, onFilter, onDetails, onAddApp, mutate };
  const header = groupCardControls(group, rules, timezone, now, onRun, controlsEnabled);

  return (
    <GroupCardFrame
      group={group}
      rules={rules}
      windows={windows}
      timezone={timezone}
      now={now}
      open={open}
      onToggle={() => setOpen(!open)}
      action={header.action}
      more={header.more}
      testID={group.id}
    >
      {open ? (
        <>
          <ExpandedGroupBody {...shared} more={more} onToggleMore={() => setMore(!more)} />
          <GroupCardLinks group={group} onDetails={onDetails} onShowLess={() => setOpen(false)} />
        </>
      ) : (
        <GroupCardMarks
          group={group}
          windows={windows}
          timezone={timezone}
          now={now}
          rules={rules}
          catalogNames={catalogNames}
          open={false}
          marks={cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, more })}
          more={more}
          onOpen={() => setOpen(true)}
          onCategory={(item) => onFilter({ category: item.key })}
          onToggleMore={() => setMore(!more)}
          onApp={(rule) => onFilter({ rule: rule.id })}
          onAddApp={onAddApp && controlsEnabled ? onAddApp : undefined}
        />
      )}
    </GroupCardFrame>
  );
}

export type ExpandedGroupProps = {
  group: Group;
  rules: Rule[];
  timezone: string;
  now: Date;
  catalogNames: CatalogNames;
  upstreamCategories: UpstreamCategoryRow[];
  /** False while the view is stale or a write for this group is in flight. */
  controlsEnabled: boolean;
  /** A tap on the group's button, or on a rule's Pause or Resume on its page, for `runGroupCardAction`. */
  onRun: (tap: GroupCardRun) => void;
  /** A mark's filter sheet: add or change its rule. */
  onFilter: (target: FilterTarget) => void;
  /** The group's page; absent on the page itself, where the schedule lists each rule with its Pause. */
  onDetails?: () => void;
  /** Blocks another app for the group; the detail offers it, as the web's member page does. */
  onAddApp?: () => void;
  mutate: HouseholdStore["mutate"];
};

/**
 * An open group card's body, wide or stacked: the group's schedule, then its categories and app
 * rules, each mark opening its filter sheet. On a card the schedule lists today's windows and
 * links to the group's page (`onDetails`); on that page it lists each rule with its Pause or
 * Resume, the quick internet schedules when the group has no internet rule, and Add a schedule.
 * Under a head that leaves out the group's note (a stacked card's), the body leads with it (`note`).
 */
export function ExpandedGroupBody({
  group,
  rules,
  timezone,
  now,
  catalogNames,
  upstreamCategories,
  controlsEnabled,
  onRun,
  onFilter,
  onDetails,
  onAddApp,
  mutate,
  more,
  onToggleMore,
  note = false,
}: ExpandedGroupProps & {
  note?: boolean;
  more: boolean;
  onToggleMore: () => void;
}) {
  const ui = useUI();
  const windows = internetWindowsForGroup(rules, group.id, now);
  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open: true, more });
  const link = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: ui.color("accent") };

  return (
    <>
      {note ? <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{cardNoteLine(group, windows)}</Text> : null}
      <View style={styles.schedule}>
        <GroupSchedule
          group={group}
          rules={rules}
          catalogNames={catalogNames}
          timezone={timezone}
          now={now}
          variant={onDetails ? "card" : "details"}
          onRun={onRun}
          enabled={controlsEnabled}
          footer={
            onDetails ? (
              <ScheduleLink label={GROUP_SCHEDULE_COPY.details} onPress={onDetails} testID={`schedule-details-${group.id}`} />
            ) : (
              <View style={styles.foot}>
                {internetRulesForGroup(rules, group.id).length === 0 ? <InternetPresets group={group} mutate={mutate} disabled={!controlsEnabled} /> : null}
                <ui.Link href={`/rules/new?group=${group.id}`} testID={`schedule-add-${group.id}`}>
                  <Text style={link}>{GROUP_SCHEDULE_COPY.add}</Text>
                </ui.Link>
              </View>
            )
          }
        />
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
        onOpen={() => undefined}
        onCategory={(item) => onFilter({ category: item.key })}
        onToggleMore={onToggleMore}
        onApp={(rule) => onFilter({ rule: rule.id })}
        onAddApp={onAddApp && controlsEnabled ? onAddApp : undefined}
      />
    </>
  );
}

/**
 * The open body of a group card in the companion's phone stack: `ExpandedGroupBody` leading with the
 * group's note, which the stack's compact head leaves out, keeping its own More.
 */
export function StackedGroupBody(props: ExpandedGroupProps) {
  const [more, setMore] = useState(false);
  return <ExpandedGroupBody {...props} note more={more} onToggleMore={() => setMore(!more)} />;
}

/**
 * An open group card's foot, as the web's action row: the group's page where the card is not the
 * page itself, and Show less where the card closes (`onShowLess`).
 */
export function GroupCardLinks({
  group,
  onDetails,
  onShowLess,
}: {
  group: Pick<Group, "id" | "name">;
  onDetails?: () => void;
  onShowLess?: () => void;
}) {
  return (
    <ActionRow
      actions={[
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
        ...(onShowLess ? [{ label: GROUP_CARD_COPY.showLess, onPress: onShowLess, testID: `group-show-less-${group.id}` }] : []),
      ]}
    />
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: 18, paddingBottom: 10, fontSize: 14, lineHeight: 20 },
  schedule: { paddingHorizontal: 12, paddingBottom: 12 },
  foot: { gap: 10, alignItems: "flex-start" },
});
