"use client";

import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * The one action button, in five roles; the role decides the skin, so a confirm pair looks the
 * same in every dialog, card and page:
 *
 * - `primary`: the one main action, filled in the accent.
 * - `secondary`: an alternative, accent text on a light accent wash with an accent hairline.
 * - `destructive`: removes or turns off something, filled red. It always asks first.
 * - `cancel`: backs out without changing anything, grey text and no border. Left-most.
 * - `quiet`: a low-weight action in grey text.
 *
 * `tinted` and `plain` are the older names for `secondary` and an accent text button. A
 * disabled filled button fades to 60% and any other to 40%. `busy` shows a spinner and holds it
 * disabled. `md` is the web's 14px button; `lg` the 16px, 44pt-tall button a phone form uses.
 * The web's own components draw the same roles from `src/components/ui/buttons.ts`.
 */
export type ButtonKind = "primary" | "secondary" | "destructive" | "cancel" | "quiet" | "tinted" | "plain";

export function Button({
  label,
  onPress,
  kind = "primary",
  size = "lg",
  busy = false,
  disabled = false,
  grow = false,
  testID,
  style,
  labelStyle,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  size?: "md" | "lg";
  busy?: boolean;
  disabled?: boolean;
  /** Fills its row: a stacked dialog footer. */
  grow?: boolean;
  testID?: string;
  /** A platform's own shape and type on top of the web's (a phone's setup draws iOS's capsules). */
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
}) {
  const ui = useUI();
  const role = kind === "tinted" ? "secondary" : kind;
  const filled = role === "primary" || role === "destructive";
  const off = disabled || busy;
  const ink = ui.color(filled ? "ink-on-fill" : role === "secondary" ? "accent-hover" : role === "plain" ? "accent" : "ink-2");
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
        size === "md" ? styles.md : styles.lg,
        grow && styles.grow,
        role === "primary" && { backgroundColor: ui.color("accent") },
        role === "destructive" && { backgroundColor: ui.color("danger") },
        role === "secondary" && { borderWidth: 1, borderColor: ui.color("accent-line"), backgroundColor: ui.color("accent-fill") },
        off && { opacity: filled ? 0.6 : 0.4 },
        pressed && !off && { opacity: PRESS_OPACITY },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : null}
      <Text style={[{ fontFamily: ui.font, fontWeight: "600", color: ink }, size === "md" ? styles.mdLabel : styles.lgLabel, labelStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, borderRadius: 9 },
  lg: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44 },
  md: { paddingVertical: 7, paddingHorizontal: 14, minHeight: 36 },
  grow: { alignSelf: "stretch" },
  lgLabel: { fontSize: 16, lineHeight: 24, textAlign: "center" },
  mdLabel: { fontSize: 14, lineHeight: 21, textAlign: "center" },
});
