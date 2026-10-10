"use client";

import { StyleSheet, View } from "react-native";

import { ruleMarkSpec } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";

import { CategoryGlyph } from "./CategoryGlyph";
import { useUI } from "./UIContext";

/**
 * The rule's kind at a glance: a square globe for all internet, a round mark for anything narrower.
 * 32 pt in a list; a stacked card's head is 44 (`size`).
 */
export function RuleMark({ rule, size = 32 }: { rule: Pick<Rule, "kind" | "targetIds">; size?: number }) {
  const ui = useUI();
  const mark = ruleMarkSpec(rule);
  const scale = size / 32;
  const box = size === 32 ? null : { width: size, height: size };
  if (mark.shape === "square") {
    return (
      <View aria-hidden style={[styles.square, box, box && { borderRadius: 8 * scale }, { backgroundColor: ui.color("accent") }]}>
        <ui.Icon name={mark.icon} size={Math.round(17 * scale)} color={ui.color("ink-on-fill")} />
      </View>
    );
  }
  const ink = ui.color("verdict-rule-ink");
  return (
    <View aria-hidden style={[styles.round, box, box && { borderRadius: size / 2 }, { backgroundColor: ui.color("verdict-rule-fill") }]}>
      {mark.slot ? (
        <CategoryGlyph slot={mark.slot} size={Math.round(15 * scale)} color={ink} />
      ) : (
        <ui.Icon name={mark.icon} size={Math.round(16 * scale)} color={ink} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  square: { width: 32, height: 32, borderRadius: 8, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  round: { width: 32, height: 32, borderRadius: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
