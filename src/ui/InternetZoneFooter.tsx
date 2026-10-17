"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import type { GroupLiftState } from "@/lib/group-actions";
import { addInternetPreset } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { internetZoneText } from "@/lib/internet-zone";
import type { InternetWindow } from "@/lib/rule-windows";
import { internetRulePresets } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { ZoneFooter, type ZoneAction } from "./CardActions";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * Under a group's internet zone: with no internet rule, one tap to a common schedule or the rule
 * editor for a custom one; otherwise More time while its pause lasts, and the way to edit its
 * internet rules.
 */
export function InternetZoneFooter({
  group,
  windows,
  timezone,
  now,
  mutate,
  showEdit = true,
  disabled = false,
  more = null,
  paused = null,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  mutate: HouseholdStore["mutate"];
  /** Link to the group's internet rules when it has one; a page that already lists them leaves it out. */
  showEdit?: boolean;
  /** True while the household is stale or a write is in flight, so nothing is sent. */
  disabled?: boolean;
  /** More time for the internet rules' pause for this group (`groupRuleActions`). */
  more?: ZoneAction | null;
  /** The internet rules' pause for this group, as the zone shows it. */
  paused?: GroupLiftState | null;
}) {
  const ui = useUI();
  const accent = ui.color("accent");
  const label = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: accent };
  if (internetZoneText(group, windows, timezone, now, paused).tone !== "no_rule") {
    return (
      <ZoneFooter
        more={more}
        edit={
          showEdit ? (
            <ui.Link href={`/rules?group=${group.id}`} testID={`edit-internet-rule-${group.id}`}>
              <Text style={label}>Edit internet rule</Text>
            </ui.Link>
          ) : null
        }
      />
    );
  }
  const chip = [styles.chip, { borderColor: ui.color("accent-line"), backgroundColor: ui.color("card") }];
  return (
    <View style={styles.presets}>
      {internetRulePresets(group).map((preset) => (
        <Pressable
          key={preset.name}
          role="button"
          aria-disabled={disabled}
          disabled={disabled}
          onPress={() => void addInternetPreset(mutate, group, preset)}
          testID={`internet-preset-${preset.name}-${group.id}`}
          style={({ pressed }) => [chip, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
        >
          <ui.Icon name="plus" size={12} color={accent} />
          <Text style={label}>{preset.label}</Text>
        </Pressable>
      ))}
      <ui.Link href={`/rules/new?kind=internet&group=${group.id}`} testID={`internet-custom-${group.id}`}>
        <View style={chip}>
          <ui.Icon name="plus" size={12} color={accent} />
          <Text style={label}>Custom schedule</Text>
        </View>
      </ui.Link>
    </View>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
});
