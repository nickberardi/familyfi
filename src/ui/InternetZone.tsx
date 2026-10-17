"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { internetDayBands, type InternetWindow } from "@/lib/rule-windows";
import type { GroupLiftState } from "@/lib/group-actions";
import { internetZoneText } from "@/lib/internet-zone";
import type { Group } from "@/lib/types";

import { CardButton, type ZoneAction } from "./CardActions";
import { useUI } from "./UIContext";
import { DayTimeline } from "./DayTimeline";

export type { ZoneAction } from "./CardActions";

/**
 * A group's device-wide controls, shared by every client: whether all of its internet is on, the
 * day's no-internet time, and Pause or Resume of its internet rules for this group alone. A group
 * with no internet rule says so. The caller supplies the action (from `groupRuleActions`), the
 * rules' pause for the group (`paused`, from `groupRulePause`) and the foot (`footer`), since each
 * platform navigates its own way.
 */
export function InternetZone({
  group,
  windows,
  timezone,
  now,
  action,
  paused = null,
  footer,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  action?: ZoneAction | null;
  paused?: GroupLiftState | null;
  /** Below the timeline (or, with no rule, the presets): More time and "Edit internet rule", say. */
  footer?: ReactNode;
}) {
  const ui = useUI();
  const zone = internetZoneText(group, windows, timezone, now, paused);
  const background =
    zone.tone === "paused" ? ui.color("paused-fill") : zone.tone === "off" ? ui.color("accent-wash") : zone.tone === "on" ? ui.color("field-soft") : undefined;
  const icon =
    zone.tone === "paused"
      ? { box: { backgroundColor: ui.color("paused") }, ink: ui.color("ink-on-fill") }
      : zone.tone === "off"
        ? { box: { backgroundColor: ui.color("accent") }, ink: ui.color("ink-on-fill") }
        : zone.tone === "on"
          ? { box: { backgroundColor: ui.color("field") }, ink: ui.color("ink-2") }
          : { box: { borderWidth: 1.5, borderStyle: "dashed" as const, borderColor: ui.color("control-line") }, ink: ui.color("ink-3") };

  return (
    <View
      style={[
        styles.zone,
        background ? { backgroundColor: background } : { borderWidth: 1.5, borderStyle: "dashed", borderColor: ui.color("control-line") },
      ]}
    >
      <View style={styles.heading}>
        <View style={[styles.icon, icon.box]} aria-hidden>
          <ui.Icon name="globe-simple" size={16} color={icon.ink} />
        </View>
        <View style={styles.words}>
          <Text role="heading" aria-level={3} style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("ink") }}>
            {zone.title}
          </Text>
          <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 20, marginTop: 2, color: ui.color("ink-2") }}>{zone.sub}</Text>
        </View>
        {action ? <CardButton action={action} /> : null}
      </View>
      {zone.tone === "no_rule" ? null : (
        <DayTimeline
          bands={internetDayBands(group, windows, now, timezone)}
          timezone={timezone}
          now={now}
          label={`${group.name}’s internet today`}
        />
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { flexDirection: "column", gap: 10, borderRadius: 10, padding: 12 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 10 },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  words: { minWidth: 140, flex: 1 },
});
