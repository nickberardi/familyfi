"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { ruleActionSpecs, ruleGroupStateLines, ruleStateLine } from "@/lib/rule-actions";
import { RULES_COPY as COPY, ruleAppliesTo, ruleCardDimmed, ruleHref, ruleWhenLines } from "@/lib/rule-list";
import { ruleBlocksLabel, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { RuleBar } from "./RuleBar";
import { RuleMark } from "./RuleMark";
import { PRESS_OPACITY, useUI } from "./UIContext";

export type RuleCardAction = "pause" | "resume" | "extend" | "allow" | "disallow";

/**
 * A rule in the Rules list: what it blocks, when, for whom, and what can be done about it now. The
 * name and the schedule open the rule; the switch turns it on or off for every group it covers.
 */
export function RuleCard({
  rule,
  groups,
  networks,
  catalogNames,
  timezone,
  now,
  disabled = false,
  onToggle,
  onAction,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  networks: { id: string; name: string }[];
  catalogNames: Map<string, string>;
  timezone: string;
  now: Date;
  /** True while the household is stale, so nothing is sent. */
  disabled?: boolean;
  onToggle: () => void;
  onAction: (action: RuleCardAction) => void;
}) {
  const ui = useUI();
  const text = (size: number, lineHeight: number) => ({ fontFamily: ui.font, fontSize: size, lineHeight });
  const groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name]));
  const state = ruleStateLine(rule, timezone, now);
  const overrides = ruleGroupStateLines(rule, groupNames, timezone, now);
  const actions = ruleActionSpecs(rule, timezone, now);
  const lines = [...(state ? [state] : []), ...overrides];
  return (
    <View
      role="article"
      testID={`rule-card-${rule.id}`}
      style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card"), opacity: ruleCardDimmed(rule, now) ? 0.7 : 1 }]}
    >
      <View style={styles.head}>
        <RuleMark rule={rule} />
        <ui.Link href={ruleHref(rule)} grow testID={`rule-open-${rule.id}`}>
          <Text role="heading" aria-level={2} style={[text(16, 24), styles.name, { color: ui.color("ink") }]}>
            {rule.name}
          </Text>
          <Text style={[text(14, 21), styles.blocks, { color: ui.color("ink-2") }]}>{ruleBlocksLabel(rule, catalogNames)}</Text>
        </ui.Link>
        <ui.Toggle label={rule.name} on={rule.enabled} onToggle={onToggle} disabled={disabled} testID={`rule-toggle-${rule.id}`} />
      </View>
      <ui.Link href={ruleHref(rule)}>
        <View style={styles.schedule}>
          <RuleBar rule={rule} />
          <View style={styles.facts}>
            <View style={styles.fact}>
              <Text style={[text(14, 21), styles.term, { color: ui.color("ink-3") }]}>{COPY.when}</Text>
              <View style={styles.value}>
                {ruleWhenLines(rule).map((line) => (
                  <Text key={line.key} style={[text(14, 21), { color: ui.color("ink") }]}>
                    {line.times}
                    {line.days ? <Text style={{ color: ui.color("ink-2") }}> · {line.days}</Text> : null}
                  </Text>
                ))}
              </View>
            </View>
            <View style={styles.fact}>
              <Text style={[text(14, 21), styles.term, { color: ui.color("ink-3") }]}>{COPY.appliesTo}</Text>
              <View style={[styles.value, styles.chips]}>
                {ruleAppliesTo(rule, groups, networks).map((name) => (
                  <Text key={name} style={[text(14, 21), styles.chip, { backgroundColor: ui.color("field"), color: ui.color("ink") }]}>
                    {name}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        </View>
      </ui.Link>
      {lines.length || actions.length ? (
        <View style={[styles.actions, { borderTopColor: ui.color("line") }]}>
          <View style={styles.lines}>
            {lines.map((line) => (
              <Text key={line} style={[text(14, 21), { color: ui.color("ink-2") }]}>
                {line}
              </Text>
            ))}
          </View>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              role="button"
              aria-disabled={disabled}
              disabled={disabled}
              testID={`rule-action-${action.run}-${rule.id}`}
              onPress={() => onAction(action.run)}
              style={({ pressed }) => [
                styles.button,
                action.strong ? { backgroundColor: ui.color("accent") } : { borderWidth: 1, borderColor: ui.color("hairline-card") },
                disabled && { opacity: 0.4 },
                pressed && !disabled && { opacity: PRESS_OPACITY },
              ]}
            >
              <Text style={[text(14, 21), styles.buttonLabel, { color: ui.color(action.strong ? "ink-on-fill" : "ink") }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", borderRadius: 12, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, paddingBottom: 12 },
  name: { margin: 0, fontWeight: "600", letterSpacing: -0.4 },
  blocks: { marginTop: 2 },
  schedule: { paddingHorizontal: 16, paddingBottom: 16 },
  facts: { marginTop: 12, gap: 6 },
  fact: { flexDirection: "row", gap: 12 },
  term: { width: 72, flexShrink: 0 },
  value: { flex: 1, minWidth: 0, gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  lines: { marginRight: "auto", flexShrink: 1 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  buttonLabel: { fontWeight: "600" },
});
