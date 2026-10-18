"use client";

import { Pressable, StyleSheet, Text } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

export type ZoneAction = {
  label: string;
  onPress: () => void;
  strong?: boolean;
  disabled?: boolean;
  /** For UI tests: `data-testid` on the web, the accessibility identifier natively. */
  testID?: string;
};

/** A group card's button: the header's Block, Unblock or Resume (strong), or a rule area's Pause or Resume. */
export function CardButton({ action }: { action: ZoneAction }) {
  const ui = useUI();
  return (
    <Pressable
      role="button"
      aria-disabled={action.disabled}
      // 44 pt to touch on a phone; react-native-web ignores it, so the web is unchanged.
      hitSlop={{ top: 6, bottom: 6 }}
      disabled={action.disabled}
      onPress={action.onPress}
      testID={action.testID}
      style={({ pressed }) => [
        styles.button,
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
  );
}

/** A text link on a card, such as More time. */
export function CardTextButton({ action }: { action: ZoneAction }) {
  const ui = useUI();
  return (
    <Pressable
      role="button"
      aria-disabled={action.disabled}
      hitSlop={{ top: 10, bottom: 10 }}
      disabled={action.disabled}
      onPress={action.onPress}
      testID={action.testID}
      style={({ pressed }) => [pressed && { opacity: PRESS_OPACITY }]}
    >
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color(action.disabled ? "disabled" : "accent") }}>
        {action.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
});
