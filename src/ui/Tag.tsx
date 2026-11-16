"use client";

import { StyleSheet, Text } from "react-native";

import type { TagTone } from "@/lib/pair-device";

import { TAG_TONES } from "./tag-tones";
import { useUI } from "./UIContext";

/**
 * A word beside a title that says what kind of thing it is: "Built-in", "Experimental", or on a
 * paired device what it may do, whose account it acts as and whether it takes alerts. Square, in
 * sentence case, grey unless given a `tone`; a group's state (online, blocked) is a badge or a
 * verdict chip, never a tag. `label` is what a screen reader says when the word alone is not enough
 * ("Acts as Nick"); the web draws it as visually hidden text (Tag.web.tsx).
 */
export function Tag({ children, label, tone = "neutral" }: { children: string; label?: string; tone?: TagTone }) {
  const ui = useUI();
  const colors = TAG_TONES[tone];
  return (
    <Text aria-label={label} style={[styles.tag, { fontFamily: ui.font, color: ui.color(colors.ink), backgroundColor: ui.color(colors.fill) }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", overflow: "hidden" },
});
