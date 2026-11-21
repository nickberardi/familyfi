"use client";

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { AskAction } from "./CardActions";
import { PRESS_OPACITY, useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";

/**
 * A waiting ask from FamilyFi Me on a group's card, open or closed: a tinted strip across the card
 * under its header, with what was asked, when, and Answer, which opens the answer sheet. Clients
 * whose card has its own padding pass `style` to run it edge to edge.
 */
export function AskStrip({ ask, style }: { ask: AskAction; style?: StyleProp<ViewStyle> }) {
  const ui = useUI();
  const largeText = useLargeText();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 } as const;
  return (
    <View style={[styles.strip, largeText && styles.stripStacked, { backgroundColor: ui.color("accent-wash"), borderColor: ui.color("line") }, style]}>
      <View style={styles.stripLine}>
        <View aria-hidden style={styles.stripIcon}>
          <ui.Icon name="hand-waving" size={17} color={ui.color("accent")} />
        </View>
        <Text style={[text, styles.stripText, { color: ui.color("ink") }]}>
          <Text style={{ fontWeight: "600" }}>{ask.label}</Text>
          <Text style={{ color: ui.color("ink-2") }}>{` · ${ask.at}`}</Text>
        </Text>
      </View>
      <Pressable
        role="button"
        aria-label={`Answer: ${ask.label}`}
        aria-disabled={ask.disabled}
        disabled={ask.disabled}
        onPress={ask.onPress}
        testID={ask.testID}
        style={({ pressed }) => [styles.answer, { backgroundColor: ui.color("accent") }, ask.disabled && { opacity: 0.6 }, pressed && { opacity: PRESS_OPACITY }]}
      >
        <Text style={[text, { fontWeight: "600", color: ui.color("ink-on-fill") }]}>Answer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 12 },
  stripStacked: { flexDirection: "column", alignItems: "stretch" },
  stripLine: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  stripIcon: { flexShrink: 0 },
  stripText: { flex: 1, minWidth: 0 },
  answer: { minHeight: 36, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7, alignItems: "center", justifyContent: "center" },
});
