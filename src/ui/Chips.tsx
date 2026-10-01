"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** A wrapping group of chips, named for screen readers. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View role="group" aria-label={label} style={styles.group}>
      {children}
    </View>
  );
}

/** A chip that is picked or not: a tick when on, a plus when not. `rule` takes the rule verdict's tint. */
export function Chip({
  on,
  onPress,
  disabled = false,
  tone = "accent",
  testID,
  children,
}: {
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
  tone?: "accent" | "rule";
  testID?: string;
  children: ReactNode;
}) {
  const ui = useUI();
  const colors = on
    ? tone === "rule"
      ? { fill: "verdict-rule-fill", ink: "verdict-rule-ink", line: "verdict-rule-line" }
      : { fill: "accent-fill", ink: "accent-hover", line: "accent-line" }
    : { fill: "card", ink: "ink-2", line: "hairline-card" };
  const ink = ui.color(colors.ink);
  return (
    <Pressable
      role="button"
      aria-pressed={on}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: ui.color(colors.fill), borderColor: ui.color(colors.line) },
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: PRESS_OPACITY },
      ]}
    >
      <Text aria-hidden style={[styles.label, { fontFamily: ui.font, color: ink }]}>
        {on ? "✓" : "+"}
      </Text>
      {typeof children === "string" ? <Text style={[styles.label, { fontFamily: ui.font, color: ink }]}>{children}</Text> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  label: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
});
