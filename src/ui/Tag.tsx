"use client";

import { StyleSheet, Text } from "react-native";

import { useUI } from "./UIContext";

/**
 * A word beside a title that says what kind of thing it is: "Built-in", "Experimental", or on a
 * paired device what it may do, whose account it acts as and whether it takes alerts. Grey and
 * square, in sentence case; a group's state (online, blocked) is a badge or a verdict chip, never a tag.
 * `label` is what a screen reader says when the word alone is not enough ("Acts as Nick").
 */
export function Tag({ children, label }: { children: string; label?: string }) {
  const ui = useUI();
  return (
    <Text aria-label={label} style={[styles.tag, { fontFamily: ui.font, color: ui.color("ink-2"), backgroundColor: ui.color("field") }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", overflow: "hidden" },
});
