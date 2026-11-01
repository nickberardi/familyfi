"use client";

import { StyleSheet, Text } from "react-native";

import { useUI } from "./UIContext";

/**
 * A word beside a title that says what kind of thing it is: "Built-in", "Experimental". Grey and
 * square, in sentence case; a state (online, blocked) is a mark or a verdict chip, never a tag.
 */
export function Tag({ children }: { children: string }) {
  const ui = useUI();
  return <Text style={[styles.tag, { fontFamily: ui.font, color: ui.color("ink-2"), backgroundColor: ui.color("field") }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", overflow: "hidden" },
});
