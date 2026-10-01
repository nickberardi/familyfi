"use client";

import { StyleSheet, Text, View } from "react-native";

import { RULE_BAR_TICKS, ruleBarBands } from "@/lib/rule-list";
import type { Rule, RuleWindow } from "@/lib/rules";

import { useUI } from "./UIContext";

const pct = (minutes: number) => `${((minutes / 1440) * 100).toFixed(3)}%` as const;

/** The rule's windows on a 24-hour bar, any day: the accent for all internet, the rule verdict's tint for anything narrower. */
export function RuleBar({ rule }: { rule: { kind: Rule["kind"]; mode: Rule["mode"]; windows: Pick<RuleWindow, "start" | "end">[] } }) {
  const ui = useUI();
  const internet = rule.kind === "internet";
  const band = internet
    ? { backgroundColor: ui.color("accent"), opacity: 0.85 }
    : { backgroundColor: ui.color("verdict-rule-fill"), boxShadow: `inset 0 0 0 1px ${ui.color("verdict-rule-line")}` };
  return (
    <View aria-hidden>
      <View style={[styles.track, { backgroundColor: ui.color("well") }]}>
        {ruleBarBands(rule).map((item, index) => (
          <View key={index} style={[styles.band, band, { left: pct(item.from), width: pct(item.to - item.from) }]} />
        ))}
      </View>
      <View style={styles.ticks}>
        {RULE_BAR_TICKS.map((tick, index) => (
          <Text key={index} style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color("muted") }}>
            {tick}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: "relative", height: 16, overflow: "hidden", borderRadius: 5 },
  band: { position: "absolute", top: 0, bottom: 0 },
  ticks: { marginTop: 4, flexDirection: "row", justifyContent: "space-between" },
});
