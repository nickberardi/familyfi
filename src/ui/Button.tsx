"use client";

import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * A form's action: filled in the accent for the main one, outlined for an alternative. `busy`
 * shows a spinner and holds it disabled. Colours are the `accent`, `ink-on-fill`, `line` and
 * `ink` tokens, so a caller on another surface supplies its own through `UIProvider`.
 */
export function Button({
  label,
  onPress,
  kind = "primary",
  busy = false,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const ui = useUI();
  const primary = kind === "primary";
  const off = disabled || busy;
  const ink = ui.color(primary ? "ink-on-fill" : "ink");
  return (
    <Pressable
      role="button"
      testID={testID}
      aria-disabled={off}
      aria-busy={busy}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: ui.color("accent") } : { borderWidth: 1, borderColor: ui.color("line") },
        off && { opacity: 0.6 },
        pressed && !off && { opacity: PRESS_OPACITY },
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={{ fontFamily: ui.font, fontSize: 16, lineHeight: 24, fontWeight: "600", color: ink }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderRadius: 9, paddingVertical: 12, minHeight: 44 },
});
