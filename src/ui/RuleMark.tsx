"use client";

import { StyleSheet, View } from "react-native";

import { ruleMarkSpec } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";

import { CategoryGlyph } from "./CategoryGlyph";
import { useUI } from "./UIContext";

/** The rule's kind at a glance: a square globe for all internet, a round mark for anything narrower. */
export function RuleMark({ rule }: { rule: Pick<Rule, "kind" | "targetIds"> }) {
  const ui = useUI();
  const mark = ruleMarkSpec(rule);
  if (mark.shape === "square") {
    return (
      <View aria-hidden style={[styles.square, { backgroundColor: ui.color("accent") }]}>
        <ui.Icon name={mark.icon} size={17} color={ui.color("ink-on-fill")} />
      </View>
    );
  }
  const ink = ui.color("verdict-rule-ink");
  return (
    <View aria-hidden style={[styles.round, { backgroundColor: ui.color("verdict-rule-fill") }]}>
      {mark.slot ? <CategoryGlyph slot={mark.slot} size={15} color={ink} /> : <ui.Icon name={mark.icon} size={16} color={ink} />}
    </View>
  );
}

const styles = StyleSheet.create({
  square: { width: 32, height: 32, borderRadius: 8, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  round: { width: 32, height: 32, borderRadius: 16, flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
