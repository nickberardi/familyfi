"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { internetDayBands, type InternetWindow } from "@/lib/rule-windows";
import { internetZoneText } from "@/lib/internet-zone";
import type { Group } from "@/lib/types";

import { PRESS_OPACITY, useUI } from "./UIContext";
import { DayTimeline } from "./DayTimeline";

export type ZoneAction = {
  label: string;
  onPress: () => void;
  strong?: boolean;
  disabled?: boolean;
  /** For UI tests: `data-testid` on the web, the accessibility identifier natively. */
  testID?: string;
};

/**
 * A group's device-wide controls, shared by every client: whether all of its internet is on,
 * the day's no-internet time, and Pause / Resume / Allow, each named for its scope. A group with
 * no internet rule says so. The caller supplies the actions (from `groupActionSpecs`) and any
 * links (`footer`), since each platform navigates its own way.
 */
export function InternetZone({
  group,
  windows,
  timezone,
  now,
  actions,
  footer,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  actions: ZoneAction[];
  /** Below the timeline (or, with no rule, the presets): an "Edit internet rule" link, say. */
  footer?: ReactNode;
}) {
  const ui = useUI();
  const zone = internetZoneText(group, windows, timezone, now);
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
        {actions.length ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                role="button"
                aria-label={`${action.label}, ${group.name}`}
                aria-disabled={action.disabled}
                disabled={action.disabled}
                onPress={action.onPress}
                testID={action.testID}
                style={({ pressed }) => [
                  styles.action,
                  action.strong
                    ? { backgroundColor: ui.color(action.disabled ? "disabled" : "accent") }
                    : { backgroundColor: ui.color("card"), borderWidth: 1, borderColor: ui.color("control-line"), paddingHorizontal: 9, paddingVertical: 5 },
                  pressed && { opacity: PRESS_OPACITY },
                ]}
              >
                <Text
                  style={{
                    fontFamily: ui.font,
                    fontSize: 14,
                    lineHeight: 21,
                    fontWeight: "600",
                    color: action.strong ? ui.color("ink-on-fill") : ui.color(action.disabled ? "disabled" : "accent"),
                  }}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
  // flexShrink lets the row narrow to the line so its buttons wrap (react-native-web defaults to 0).
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6, flexShrink: 1 },
  action: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
});
