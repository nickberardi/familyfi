"use client";

import { StyleSheet, Text, View } from "react-native";

import { RULES_COPY as COPY, noRulesFor, rulesScopeHref, unruledLine } from "@/lib/rule-list";
import type { Group } from "@/lib/types";

import { useUI } from "./UIContext";

/** The groups some rule covers, to narrow the list to one; "All" shows every rule. */
export function RuleScopeChips({ chips, scopedId }: { chips: Pick<Group, "id" | "name">[]; scopedId: string | null }) {
  const ui = useUI();
  return (
    <View role="navigation" aria-label={COPY.scopeLabel} style={styles.chips}>
      {[{ id: null, name: COPY.all }, ...chips].map((chip) => {
        const on = scopedId === chip.id;
        return (
          <ui.Link key={chip.id ?? "all"} href={rulesScopeHref(chip.id)} current={on} testID={`rule-scope-${chip.id ?? "all"}`}>
            <Text
              style={[
                styles.chip,
                {
                  fontFamily: ui.font,
                  backgroundColor: ui.color(on ? "accent-fill" : "card"),
                  color: ui.color(on ? "accent-hover" : "ink"),
                  borderColor: ui.color(on ? "accent-line" : "hairline-card"),
                },
              ]}
            >
              {chip.name}
            </Text>
          </ui.Link>
        );
      })}
    </View>
  );
}

/** A group with no rules yet, and the way to make one. */
export function NoRulesCard({ group, newHref }: { group: Pick<Group, "name" | "kind">; newHref: string }) {
  const ui = useUI();
  return (
    <View style={[styles.card, styles.noRules, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}>
      <Text style={[styles.body, styles.grow, { fontFamily: ui.font, color: ui.color("ink") }]}>{noRulesFor(group)}</Text>
      <ui.Link href={newHref}>
        <Text style={[styles.body, styles.newRule, { fontFamily: ui.font, backgroundColor: ui.color("accent"), color: ui.color("ink-on-fill") }]}>
          {COPY.newRule}
        </Text>
      </ui.Link>
    </View>
  );
}

/** The groups no rule covers: they stay online and unfiltered. */
export function UnruledNote({ names }: { names: string[] }) {
  const ui = useUI();
  return (
    <View style={[styles.card, styles.unruled, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}>
      <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink") }]}>{unruledLine(names)}</Text>
      <ui.Link href="/rules/new">
        <Text style={[styles.body, { fontFamily: ui.font, fontWeight: "600", color: ui.color("accent") }]}>{COPY.newRule}</Text>
      </ui.Link>
    </View>
  );
}

/** How rules reach the gateway. */
export function RulesFootnote() {
  const ui = useUI();
  return <Text style={[styles.body, styles.footnote, { fontFamily: ui.font, color: ui.color("ink-2") }]}>{COPY.footnote}</Text>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, fontSize: 14, lineHeight: 21, fontWeight: "600", overflow: "hidden" },
  card: { borderRadius: 12, borderWidth: 1, padding: 18 },
  noRules: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  unruled: { flexDirection: "row", flexWrap: "wrap", columnGap: 4 },
  grow: { flex: 1 },
  body: { fontSize: 14, lineHeight: 21 },
  newRule: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, fontWeight: "600", overflow: "hidden" },
  footnote: { maxWidth: 560, lineHeight: 20 },
});
