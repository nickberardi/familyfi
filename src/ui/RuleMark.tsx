"use client";

import { StyleSheet, View } from "react-native";

import { ruleMarkSpec } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";

import { useUI } from "./UIContext";

/**
 * The rule's kind at a glance: one grey tile for every rule, standard or built-in, so its glyph says
 * what it blocks and the card's switch says whether it is on. 34 pt in a list; a stacked card's head
 * is 44 (`size`).
 */
export function RuleMark({ rule, size = 34 }: { rule: Pick<Rule, "kind" | "targetIds"> & Partial<Pick<Rule, "builtIn">>; size?: number }) {
  const ui = useUI();
  const mark = ruleMarkSpec(rule);
  const scale = size / 34;
  return (
    <View aria-hidden style={[styles.tile, { width: size, height: size, borderRadius: 9 * scale, backgroundColor: ui.color("field") }]}>
      <ui.Icon name={mark.icon} size={Math.round(17 * scale)} color={ui.color("ink-2")} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
