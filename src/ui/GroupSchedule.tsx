"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { groupScheduleRuleRows, groupScheduleToday } from "@/lib/group-schedule";
import type { GroupCardRun } from "@/lib/group-writes";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { CardButton, CardTextButton } from "./CardActions";
import { DayTimeline } from "./DayTimeline";
import { PRESS_OPACITY, useUI } from "./UIContext";

/** The schedule's words, on every client. */
export const GROUP_SCHEDULE_COPY = {
  title: "Today’s schedule",
  none: "Nothing scheduled. Add a schedule to block the internet, a category or an app at set times.",
  details: "Pause or change schedules →",
  add: "+ Add a schedule",
} as const;

/**
 * A group's schedule, shared by every client: every rule that applies to the group on one bar,
 * then a list. On a card (`variant="card"`) the list is today's windows in time order and the
 * foot links to the group's page (`footer`); on that page (`"details"`) each rule is listed once,
 * its name opens its editor, and Pause or Resume (with More time while a timed pause lasts) acts
 * for this group alone, through `onRun` (`runGroupCardAction`).
 */
export function GroupSchedule({
  group,
  rules,
  catalogNames,
  timezone,
  now,
  variant,
  onRun,
  enabled = true,
  footer = null,
}: {
  group: Group;
  rules: Rule[];
  catalogNames: Map<string, string>;
  timezone: string;
  now: Date;
  variant: "card" | "details";
  onRun?: (tap: GroupCardRun) => void;
  /** False while the view is stale or a write is in flight. */
  enabled?: boolean;
  footer?: ReactNode;
}) {
  const ui = useUI();
  const today = groupScheduleToday(group, rules, catalogNames, timezone, now);
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const state = (value: string | null, live: boolean) =>
    value ? <Text style={{ fontWeight: "600", color: ui.color(live ? "verdict-rule-ink" : "ink-3") }}>{`  ${value}`}</Text> : null;

  const rows =
    variant === "card"
      ? today.rows.map((row, index) => (
          <View key={row.key} role="listitem" style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ui.color("hairline") }]}>
            <Swatch tone={row.tone} />
            <Text style={[text, styles.grow, { color: ui.color("ink") }]}>
              <Text style={{ fontWeight: "600" }}>{row.title}</Text>
              <Text style={{ color: ui.color("ink-2") }}> · {row.detail}</Text>
              {state(row.state, row.live)}
            </Text>
          </View>
        ))
      : groupScheduleRuleRows(group, rules, catalogNames, timezone, now).map((row, index) => {
          const tap = (spec: NonNullable<typeof row.action>) => ({
            label: spec.label,
            disabled: !enabled,
            onPress: () => onRun?.({ kind: "rule", run: spec.run, ruleIds: [row.ruleId], name: row.title }),
            testID: `schedule-${spec.run}-${row.ruleId}-${group.id}`,
          });
          return (
            <View key={row.ruleId} role="listitem" style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ui.color("hairline") }]}>
              <Swatch tone={row.tone} />
              <View style={styles.grow}>
                <ui.Link href={`/rules/${row.ruleId}?group=${group.id}`} testID={`schedule-rule-${row.ruleId}-${group.id}`}>
                  <Text style={[text, { fontWeight: "600", color: ui.color("accent") }]}>{row.title}</Text>
                </ui.Link>
                <Text style={[text, { color: ui.color("ink-2") }]}>
                  {row.times}
                  {state(row.state, row.live)}
                </Text>
                {row.more && onRun ? (
                  <View style={styles.more}>
                    <CardTextButton action={tap(row.more)} />
                  </View>
                ) : null}
              </View>
              {row.action && onRun ? <CardButton action={tap(row.action)} /> : null}
            </View>
          );
        });

  return (
    <View style={[styles.box, { backgroundColor: ui.color("field-soft") }]} testID={`schedule-${group.id}`}>
      <Text role="heading" aria-level={3} style={[text, { fontWeight: "600", color: ui.color("ink") }]}>
        {GROUP_SCHEDULE_COPY.title}
      </Text>
      <DayTimeline bands={today.bands} timezone={timezone} now={now} label={`${group.name}’s schedule today`} legend={false} />
      {rows.length ? (
        <View role="list">{rows}</View>
      ) : (
        <Text style={[text, { color: ui.color("ink-2") }]}>{GROUP_SCHEDULE_COPY.none}</Text>
      )}
      {footer}
    </View>
  );
}

/** A rule's colour beside its row: the internet's blue, or its schedule colour. */
function Swatch({ tone }: { tone: number | null }) {
  const ui = useUI();
  const look =
    tone === null
      ? { backgroundColor: ui.color("accent"), opacity: 0.85 }
      : { backgroundColor: ui.color(`schedule-${tone + 1}-fill`), borderWidth: 1, borderColor: ui.color(`schedule-${tone + 1}-line`) };
  return <View aria-hidden style={[styles.swatch, look]} />;
}

/** A text link at the foot of a schedule: "Pause or change schedules →" on a card. */
export function ScheduleLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const ui = useUI();
  return (
    <Pressable role="link" onPress={onPress} testID={testID} hitSlop={{ top: 10, bottom: 10 }} style={({ pressed }) => [styles.link, pressed && { opacity: PRESS_OPACITY }]}>
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("accent") }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  grow: { flex: 1, minWidth: 0 },
  swatch: { width: 12, height: 12, borderRadius: 3, flexShrink: 0 },
  more: { flexDirection: "row", marginTop: 2 },
  link: { alignSelf: "flex-end" },
});
