"use client";

import { StyleSheet, Text, View } from "react-native";

import { SETTINGS_COPY as COPY } from "@/lib/settings-copy";

import { useUI } from "./UIContext";

/**
 * Whether an adult is an admin, as the platform's switch with its word beside it: a native switch
 * shows only its state. Turning it on for an adult with no login starts one.
 */
export function AdminControl({
  name,
  on,
  onPress,
  disabled,
  testID,
}: {
  name: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const ui = useUI();
  return (
    <View style={styles.row}>
      <ui.Toggle
        label={`${name} ${COPY.admin.toLowerCase()}`}
        on={on}
        onToggle={onPress}
        onLabel={COPY.admin}
        offLabel={COPY.admin}
        disabled={disabled}
        testID={testID}
      />
      {/* The switch carries the accessible name, so the word is not read twice. */}
      <Text
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={[
          {
            fontFamily: ui.font,
            fontSize: 14,
            lineHeight: 21,
            color: ui.color(disabled ? "disabled" : "ink"),
          },
          styles.word,
        ]}
      >
        {COPY.admin}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  word: { fontWeight: "600" },
});
