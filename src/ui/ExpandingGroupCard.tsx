"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { cardMarks, categorySlotStates, type CatalogNames } from "@/lib/category-marks";
import { cardNoteLine } from "@/lib/display";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import type { GroupCardRun } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { internetWindowsForGroup, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import type { UpstreamCategoryRow } from "@/lib/upstream";

import { ActionRow } from "./ActionRow";
import { CategoryZone } from "./CategoryZone";
import { groupCardControls } from "./group-card-controls";
import { GroupCardFrame } from "./GroupCardFrame";
import { GroupCardMarks } from "./GroupCardMarks";
import { InternetZone } from "./InternetZone";
import { InternetZoneFooter } from "./InternetZoneFooter";
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
  /** The group detail; absent on the detail itself. */
  onDetails?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const windows = internetWindowsForGroup(rules, group.id, now);
  const openOn = (slot?: string) => {
    if (slot) setFocus(slot);
    setOpen(true);
  };
  const shared = { group, rules, timezone, now, catalogNames, upstreamCategories, controlsEnabled, onRun, onFilter, onAddApp, mutate };
  const { header } = groupCardControls(group, rules, null, timezone, now, onRun, controlsEnabled);

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
          <ExpandedGroupBody {...shared} focus={focus} onFocus={setFocus} more={more} onToggleMore={() => setMore(!more)} />
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
          marks={cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, focus, more })}
          more={more}
          onOpen={openOn}
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
  /** A tap on one of the card's buttons, for `runGroupCardAction`. */
  onRun: (tap: GroupCardRun) => void;
  /** A mark's filter sheet: add or change its rule. */
  onFilter: (target: FilterTarget) => void;
  /** Blocks another app for the group; the detail offers it, as the web's member page does. */
  onAddApp?: () => void;
  mutate: HouseholdStore["mutate"];
};

/**
 * An open group card's body, wide or stacked: the internet zone, one focused category, each with
 * its Pause or Resume for this group, then the row of marks (the other categories and app rules).
 * A mark focuses its category; Edit rule, Edit internet rule and Add rule open the editor and the
 * filter sheet. Under
 * a head that leaves out the group's note (a stacked card's), the body leads with it (`note`).
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
  onAddApp,
  mutate,
  focus,
  onFocus,
  more,
  onToggleMore,
  note = false,
}: ExpandedGroupProps & {
  note?: boolean;
  focus: string | null;
  onFocus: (slot: string) => void;
  more: boolean;
  onToggleMore: () => void;
}) {
  const ui = useUI();
  const windows = internetWindowsForGroup(rules, group.id, now);
  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open: true, focus, more });
  const { focused } = marks;
  const controls = groupCardControls(group, rules, focused ?? null, timezone, now, onRun, controlsEnabled);

  return (
    <>
      {note ? <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{cardNoteLine(group, windows)}</Text> : null}
      <View style={styles.zones}>
        <InternetZone
          group={group}
          windows={windows}
          timezone={timezone}
          now={now}
          action={controls.internet.action}
          paused={controls.internet.paused}
          footer={
            <InternetZoneFooter
              group={group}
              windows={windows}
              timezone={timezone}
              now={now}
              mutate={mutate}
              disabled={!controlsEnabled}
              more={controls.internet.more}
              paused={controls.internet.paused}
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
            action={controls.category?.action}
            more={controls.category?.more}
            paused={controls.category?.paused}
            editRule={focused.rule ? <EditRuleLink group={group} slot={focused.key} label={focused.label} rule={focused.rule} /> : null}
          />
        ) : null}
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
        onOpen={(slot) => (slot ? onFocus(slot) : undefined)}
        onToggleMore={onToggleMore}
        onApp={(rule) => onFilter({ rule: rule.id })}
        onAddApp={onAddApp && controlsEnabled ? onAddApp : undefined}
      />
    </>
  );
}

/**
 * The open body of a group card in the companion's phone stack: `ExpandedGroupBody` leading with the
 * group's note, which the stack's compact head leaves out, keeping its own focus and More.
 */
export function StackedGroupBody(props: ExpandedGroupProps) {
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  return <ExpandedGroupBody {...props} note focus={focus} onFocus={setFocus} more={more} onToggleMore={() => setMore(!more)} />;
}

/**
 * An open group card's foot, as the web's action row: the group's rules, its detail where the card
 * is not the detail itself, and Show less where the card closes (`onShowLess`).
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
        ...(onShowLess ? [{ label: GROUP_CARD_COPY.showLess, onPress: onShowLess, testID: `group-show-less-${group.id}` }] : []),
      ]}
    />
  );
}

/** A focused category's way to its rule's editor, scoped to the card's group: "Edit Video rule". */
export function EditRuleLink({
  group,
  slot,
  label,
  rule,
}: {
  group: Pick<Group, "id">;
  slot: string;
  label: string;
  rule: Pick<Rule, "id">;
}) {
  const ui = useUI();
  return (
    <ui.Link href={`/rules/${rule.id}?group=${group.id}`} testID={`edit-rule-${slot}-${group.id}`}>
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("accent") }}>{GROUP_CARD_COPY.editRule(label)}</Text>
    </ui.Link>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: 18, paddingBottom: 10, fontSize: 14, lineHeight: 20 },
  zones: { gap: 10, paddingHorizontal: 12, paddingBottom: 12 },
});
