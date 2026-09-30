"use client";

import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * A form's action: filled in the accent for the main one (`primary`), outlined for an alternative
 * (`secondary`), a tinted wash (`tinted`) or bare text (`plain`) for a quieter one. `busy` shows a
 * spinner and holds it disabled. Colours are the `accent`, `accent-tint`, `ink-on-fill`, `line` and
 * `ink` tokens, so a caller on another surface supplies its own through `UIProvider`.
 */
export function Button({
  label,
  onPress,
  kind = "primary",
  busy = false,
  disabled = false,
  testID,
  style,
  labelStyle,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "tinted" | "plain";
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  /** A platform's own shape and type on top of the web's (a phone's setup draws iOS's capsules). */
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const ui = useUI();
  const primary = kind === "primary";
  const off = disabled || busy;
  const ink = ui.color(primary ? "ink-on-fill" : kind === "secondary" ? "ink" : "accent");
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
        primary && { backgroundColor: ui.color("accent") },
        kind === "secondary" && { borderWidth: 1, borderColor: ui.color("line") },
        kind === "tinted" && { backgroundColor: ui.color("accent-tint") },
        off && { opacity: 0.6 },
        pressed && !off && { opacity: PRESS_OPACITY },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[{ fontFamily: ui.font, fontSize: 16, lineHeight: 24, fontWeight: "600", color: ink }, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderRadius: 9, paddingVertical: 12, minHeight: 44 },
});
