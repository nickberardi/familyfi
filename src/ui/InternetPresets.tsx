"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { addInternetPreset } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";
import { internetRulePresets } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * For a group with no internet rule, one tap to a common no-internet schedule, or the rule editor
 * for a custom one. Shared by every client, under the group's schedule on its page.
 */
export function InternetPresets({
  group,
  mutate,
  disabled = false,
}: {
  group: Group;
  mutate: HouseholdStore["mutate"];
  /** True while the household is stale or a write is in flight, so nothing is sent. */
  disabled?: boolean;
}) {
  const ui = useUI();
  const accent = ui.color("accent");
  const label = { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600" as const, color: accent };
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
