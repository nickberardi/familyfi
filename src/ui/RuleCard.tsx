"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { ruleActionSpecs, ruleGroupStateLines, ruleStateLine } from "@/lib/rule-actions";
import { RULES_COPY as COPY, ruleAppliesTo, ruleCardDimmed, ruleEditable, ruleHref, ruleStatus, ruleToggleLabels, ruleWhenLines } from "@/lib/rule-list";
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
  // An off or paused rule fades its mark only: its text, and the bar's hours, keep full contrast.
  const faded = ruleCardDimmed(rule, now) ? styles.faded : null;
  return (
    <View
      role="article"
      testID={`rule-card-${rule.id}`}
      style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}
    >
      <View style={styles.head}>
        <View style={faded}>
          <RuleMark rule={rule} />
        </View>
        <ui.Link href={ruleHref(rule)} grow testID={`rule-open-${rule.id}`}>
          <View style={styles.nameRow}>
            <Text role="heading" aria-level={2} style={[text(ui.font, 16, 24), styles.name, { color: ui.color("ink") }]}>
              {rule.name}
            </Text>
            {rule.builtIn ? <BuiltInTag /> : null}
          </View>
          <Text style={[text(ui.font, 14, 21), styles.blocks, { color: ui.color("ink-2") }]}>{ruleBlocksLabel(rule, catalogNames)}</Text>
        </ui.Link>
        <RuleToggle rule={rule} disabled={disabled} onToggle={onToggle} />
      </View>
      <RuleCardSchedule rule={rule} groups={groups} networks={networks} />
      <RuleCardActions rule={rule} groups={groups} timezone={timezone} now={now} disabled={disabled} onAction={onAction} />
    </View>
  );
}

/**
 * A rule card's schedule, which opens the rule: its windows on a bar, then when it blocks and whom
 * it covers. A stacked card, whose head names the rule's state instead, leads with what it blocks (`blocks`).
 */
export function RuleCardSchedule({
  rule,
  groups,
  networks,
  blocks,
  testID,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  networks: { id: string; name: string }[];
  /** What it blocks, `ruleBlocksLabel(...)`, above the bar. */
  blocks?: string;
  /** On the link to the rule's page, where the card's name is not that link. */
  testID?: string;
}) {
  const ui = useUI();
  return (
    <ui.Link href={ruleHref(rule)} testID={testID}>
      <View style={styles.schedule}>
        {blocks ? <Text style={[text(ui.font, 14, 21), styles.lead, { color: ui.color("ink-2") }]}>{blocks}</Text> : null}
        <RuleBar rule={rule} />
        <RuleFacts rule={rule} groups={groups} networks={networks} />
      </View>
    </ui.Link>
  );
}

/** The open body of a rule card in the companion's phone stack: what it blocks, then its schedule, which opens the rule. */
export function StackedRuleBody({
  rule,
  groups,
  networks,
  catalogNames,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  networks: { id: string; name: string }[];
  catalogNames: Map<string, string>;
}) {
  return (
    <RuleCardSchedule
      rule={rule}
      groups={groups}
      networks={networks}
      blocks={ruleBlocksLabel(rule, catalogNames)}
      testID={`rule-open-${rule.id}`}
    />
  );
}

/** When a rule blocks and whom it covers, under its bar. */
function RuleFacts({
  rule,
  groups,
  networks,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  networks: { id: string; name: string }[];
}) {
  const ui = useUI();
  const body = text(ui.font, 14, 21);
  return (
    <View style={styles.facts}>
      <View style={styles.fact}>
        <Text style={[body, styles.term, { color: ui.color("ink-3") }]}>{COPY.when}</Text>
        <View style={styles.value}>
          {ruleWhenLines(rule).map((line) => (
            <Text key={line.key} style={[body, { color: ui.color("ink") }]}>
              {line.times}
              {line.days ? <Text style={{ color: ui.color("ink-2") }}> · {line.days}</Text> : null}
            </Text>
          ))}
        </View>
      </View>
      <View style={styles.fact}>
        <Text style={[body, styles.term, { color: ui.color("ink-3") }]}>{COPY.appliesTo}</Text>
        <View style={[styles.value, styles.chips]}>
          {ruleAppliesTo(rule, groups, networks).map((name) => (
            <Text key={name} style={[body, styles.chip, { backgroundColor: ui.color("field"), color: ui.color("ink") }]}>
              {name}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * A rule card's foot: Edit, then whether it is paused, for everyone or for a group, and what can be
 * done about it now. An off rule keeps its foot for Edit; quarantine, never edited, has none of its own.
 */
export function RuleCardActions({
  rule,
  groups,
  timezone,
  now,
  disabled = false,
  onAction,
}: {
  rule: Rule;
  groups: Pick<Group, "id" | "name">[];
  timezone: string;
  now: Date;
  disabled?: boolean;
  onAction: (action: RuleCardAction) => void;
}) {
  const ui = useUI();
  const body = text(ui.font, 14, 21);
  const groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name]));
  const state = ruleStateLine(rule, timezone, now);
  const overrides = ruleGroupStateLines(rule, groupNames, timezone, now);
  const actions = ruleActionSpecs(rule, timezone, now);
  const lines = [...(state ? [state] : []), ...overrides];
  const editable = ruleEditable(rule);
  if (!lines.length && !actions.length && !editable) return null;
  return (
    <View style={[styles.actions, { borderTopColor: ui.color("line") }]}>
      {editable ? (
        <ui.Link href={ruleHref(rule)} label={`${COPY.edit} ${rule.name}`} testID={`rule-edit-${rule.id}`}>
          <View style={[styles.button, { borderWidth: 1, borderColor: ui.color("hairline-card") }]}>
            <Text style={[body, styles.buttonLabel, { color: ui.color("ink") }]}>{COPY.edit}</Text>
          </View>
        </ui.Link>
      ) : null}
      <View style={styles.lines}>
        {lines.map((line) => (
          <Text key={line} style={[body, { color: ui.color("ink-2") }]}>
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
          <Text style={[body, styles.buttonLabel, { color: ui.color(action.strong ? "ink-on-fill" : "ink") }]}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A rule's switch: on or off for every group it covers. */
export function RuleToggle({ rule, disabled = false, onToggle }: { rule: Rule; disabled?: boolean; onToggle: () => void }) {
  const ui = useUI();
  return <ui.Toggle label={rule.name} on={rule.enabled} onToggle={onToggle} disabled={disabled} {...ruleToggleLabels(rule)} testID={`rule-toggle-${rule.id}`} />;
}

/**
 * A rule as a stacked card shows it closed: its mark, its name, and one line in the colour of what
 * it is doing now (`ruleStatus`). Its switch (`RuleToggle`) and opening the card are the caller's.
 */
export function RuleCardSummary({ rule, timezone, now }: { rule: Rule; timezone: string; now: Date }) {
  const ui = useUI();
  const status = ruleStatus(rule, timezone, now);
  const tone = ui.color(status.tone);
  return (
    <View style={styles.summary}>
      <View style={ruleCardDimmed(rule, now) ? styles.faded : null}>
        <RuleMark rule={rule} size={44} />
      </View>
      <View style={styles.value}>
        <View style={styles.summaryName}>
          <Text role="heading" aria-level={2} numberOfLines={1} style={[text(ui.font, 19, 26), styles.title, styles.shrink, { color: ui.color("ink") }]}>
            {rule.name}
          </Text>
          {rule.builtIn ? <BuiltInTag /> : null}
        </View>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Text numberOfLines={1} style={[text(ui.font, 14, 21), styles.shrink, { color: tone }]}>
            {status.line}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** A built-in rule's tag, beside its name. */
function BuiltInTag() {
  const ui = useUI();
  return <Text style={[text(ui.font, 14, 20), styles.builtIn, { color: ui.color("ink-2"), backgroundColor: ui.color("field") }]}>{COPY.builtIn}</Text>;
}

function text(font: string | undefined, size: number, lineHeight: number) {
  return { fontFamily: font, fontSize: size, lineHeight };
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", borderRadius: 12, borderWidth: 1 },
  faded: { opacity: 0.4 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, paddingBottom: 12 },
  nameRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  summaryName: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { margin: 0, fontWeight: "600", letterSpacing: -0.4 },
  builtIn: { flexShrink: 0, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, fontWeight: "600", overflow: "hidden" },
  blocks: { marginTop: 2 },
  lead: { marginBottom: 10 },
  schedule: { paddingHorizontal: 16, paddingBottom: 16 },
  facts: { marginTop: 12, gap: 6 },
  fact: { flexDirection: "row", gap: 12 },
  term: { minWidth: 72, flexShrink: 0 },
  value: { flex: 1, minWidth: 0, gap: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  lines: { marginRight: "auto", flexShrink: 1 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  buttonLabel: { fontWeight: "600" },
  summary: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontWeight: "600", letterSpacing: -0.475 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  shrink: { flexShrink: 1 },
});
