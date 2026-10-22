"use client";

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  CHECKUP_COPY as COPY,
  checkupCopy,
  checkupSections,
  checkupSummary,
  protectionLine,
  protectionTitle,
  type CheckupFinding,
  type CheckupState,
} from "@/lib/checkup";
import type { IconName } from "@/lib/icons";
import { ruleHref } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { ExternalLink } from "./ExternalLink";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * Checkup's first card: FamilyFi's recommended protections, each the switch of a built-in rule, and
 * one button that turns on whichever are off. Edit opens the rule's own page.
 */
export function ProtectionCard({
  rules,
  groups,
  disabled = false,
  onToggle,
  onTurnOnAll,
}: {
  /** `recommendedRules(...)`. */
  rules: Rule[];
  groups: Pick<Group, "id" | "name">[];
  disabled?: boolean;
  onToggle: (rule: Rule) => void;
  onTurnOnAll: () => void;
}) {
  const ui = useUI();
  const on = rules.filter((rule) => rule.enabled).length;
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="checkup-protection">
      <CardHead title={COPY.protection.title} trailing={<Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{COPY.protection.on(on, rules.length)}</Text>} />
      {rules.map((rule) => (
        <Row key={rule.id} icon={rule.builtIn === "countries" ? "globe-simple" : "shield-check"} tone="accent" testID={`checkup-protection-${rule.id}`}>
          <View style={styles.grow}>
            <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{protectionTitle(rule)}</Text>
            <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>
              {protectionLine(rule, groups)}
            </Text>
            {rule.builtIn !== "quarantine" ? (
              <ui.Link href={ruleHref(rule)} testID={`checkup-edit-${rule.id}`}>
                <Text style={[styles.action, styles.edit, { fontFamily: ui.font, color: ui.color("accent") }]}>{COPY.protection.edit}</Text>
              </ui.Link>
            ) : null}
          </View>
          <ui.Toggle label={protectionTitle(rule)} on={rule.enabled} onToggle={() => onToggle(rule)} disabled={disabled} testID={`checkup-toggle-${rule.id}`} />
        </Row>
      ))}
      {on < rules.length ? (
        <View style={styles.footer}>
          <Pressable
            role="button"
            aria-disabled={disabled}
            disabled={disabled}
            onPress={onTurnOnAll}
            testID="checkup-turn-on-all"
            style={({ pressed }) => [styles.primary, { backgroundColor: ui.color("accent") }, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
          >
            <Text style={[styles.primaryLabel, { fontFamily: ui.font, color: ui.color("ink-on-fill") }]}>{COPY.protection.turnOnAll}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Checkup's second card: what the network checkup found, problems first, then notes that may be on
 * purpose, then the checks that passed. FamilyFi only reads; each finding says how to change it.
 */
export function NetworkCheckupCard({
  checkup,
  checking = false,
  disabled = false,
  now,
  onCheckNow,
  onDismiss,
}: {
  checkup: CheckupState | null;
  checking?: boolean;
  disabled?: boolean;
  now?: Date;
  onCheckNow: () => void;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
}) {
  const ui = useUI();
  const [showPassed, setShowPassed] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const sections = checkupSections(checkup ?? { findings: [] });
  const passed = checkup?.passed ?? [];
  const body = [styles.body, { fontFamily: ui.font }];
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="checkup-network">
      <CardHead
        title={COPY.network.title}
        sub={checkupSummary(checkup, now)}
        trailing={
          <Pressable role="button" aria-disabled={disabled || checking} disabled={disabled || checking} onPress={onCheckNow} testID="checkup-run" style={({ pressed }) => [(disabled || checking) && { opacity: 0.5 }, pressed && { opacity: PRESS_OPACITY }]}>
            <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("accent") }]}>{checking ? COPY.network.checking : COPY.network.checkNow}</Text>
          </Pressable>
        }
      />
      {checkup?.error ? (
        <Text role="alert" style={[body, styles.error, { backgroundColor: ui.color("danger-fill"), color: ui.color("danger") }]} testID="checkup-error">
          {COPY.network.error} {checkup.error}
        </Text>
      ) : null}
      {sections.problems.length ? <SubHead>{COPY.network.problems(sections.problems.length)}</SubHead> : null}
      {sections.problems.map((finding, index) => (
        <FindingRow key={finding.id} finding={finding} initiallyOpen={index === 0} disabled={disabled} onDismiss={onDismiss} />
      ))}
      {sections.notes.length ? <SubHead>{COPY.network.notes(sections.notes.length)}</SubHead> : null}
      {sections.notes.map((finding) => (
        <FindingRow key={finding.id} finding={finding} disabled={disabled} onDismiss={onDismiss} />
      ))}
      {sections.dismissed.length ? (
        <>
          <Fold icon="x" label={COPY.network.dismissedCount(sections.dismissed.length)} open={showDismissed} onPress={() => setShowDismissed(!showDismissed)} testID="checkup-dismissed" />
          {showDismissed ? sections.dismissed.map((finding) => <FindingRow key={finding.id} finding={finding} disabled={disabled} onDismiss={onDismiss} />) : null}
        </>
      ) : null}
      {passed.length ? (
        <>
          <Fold icon="check-circle" label={COPY.network.passed(passed.length)} open={showPassed} onPress={() => setShowPassed(!showPassed)} testID="checkup-passed" />
          {showPassed ? (
            <View style={styles.passedList}>
              {passed.map((check) => (
                <Text key={check} style={[body, { color: ui.color("ink-2") }]}>
                  ✓ {COPY.checkNames[check]}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      <Text style={[body, styles.readOnly, { color: ui.color("ink-3"), borderTopColor: ui.color("hairline") }]}>{COPY.network.readOnly}</Text>
    </View>
  );
}

function FindingRow({
  finding,
  initiallyOpen = false,
  disabled,
  onDismiss,
}: {
  finding: CheckupFinding;
  initiallyOpen?: boolean;
  disabled: boolean;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
}) {
  const ui = useUI();
  const [open, setOpen] = useState(initiallyOpen);
  const copy = checkupCopy(finding);
  const note = finding.kind === "note";
  const body = [styles.body, { fontFamily: ui.font }];
  const action = [styles.action, { fontFamily: ui.font, color: ui.color("accent") }];
  return (
    <Row icon={copy.icon} tone={note || finding.dismissed ? "muted" : "paused"} testID={`checkup-finding-${finding.id}`}>
      <View style={styles.grow}>
        <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{copy.title}</Text>
        <Text style={[body, { color: ui.color("ink-2") }]}>{copy.seen}</Text>
        {open ? (
          <>
            <Text style={[body, styles.gap, { color: ui.color("ink-3") }]}>{copy.why}</Text>
            <Text style={[styles.label, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{note ? COPY.network.ifYouWant : COPY.network.howToFix}</Text>
            {copy.fix.map((step, index) => (
              <Text key={step} style={[body, { color: ui.color("ink-2") }]}>
                {copy.fix.length > 1 ? `${index + 1}. ` : ""}
                {step}
              </Text>
            ))}
          </>
        ) : null}
        <View style={styles.actions}>
          {!open ? (
            <Pressable role="button" onPress={() => setOpen(true)} testID={`checkup-open-${finding.id}`}>
              <Text style={action}>{note ? COPY.network.more : COPY.network.howToFix}</Text>
            </Pressable>
          ) : null}
          {copy.guide ? (
            <ExternalLink href={copy.guide.href} style={action} color={ui.color("accent")}>
              {copy.guide.label}
            </ExternalLink>
          ) : null}
          {copy.show ? (
            <ui.Link href={copy.show.href}>
              <Text style={action}>{copy.show.label}</Text>
            </ui.Link>
          ) : null}
          <Pressable role="button" aria-disabled={disabled} disabled={disabled} onPress={() => onDismiss(finding, !finding.dismissed)} testID={`checkup-dismiss-${finding.id}`}>
            <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("ink-3") }]}>
              {finding.dismissed ? COPY.network.restore : note ? COPY.network.intended : COPY.network.dismiss}
            </Text>
          </Pressable>
        </View>
      </View>
    </Row>
  );
}

function CardHead({ title, sub, trailing }: { title: string; sub?: string; trailing?: ReactNode }) {
  const ui = useUI();
  return (
    <View style={styles.head}>
      <View style={styles.grow}>
        <Text role="heading" aria-level={2} style={[styles.cardTitle, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {title}
        </Text>
        {sub ? <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{sub}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

const MARK_TONE = {
  accent: { fill: "accent-tint", ink: "accent" },
  paused: { fill: "paused-fill", ink: "paused" },
  muted: { fill: "field", ink: "ink-3" },
} as const;

function Row({ icon, tone, testID, children }: { icon: IconName; tone: keyof typeof MARK_TONE; testID?: string; children: ReactNode }) {
  const ui = useUI();
  const colors = MARK_TONE[tone];
  return (
    <View style={[styles.row, { borderTopColor: ui.color("hairline") }]} testID={testID}>
      <View aria-hidden style={[styles.mark, { backgroundColor: ui.color(colors.fill) }]}>
        <ui.Icon name={icon} size={17} color={ui.color(colors.ink)} />
      </View>
      {children}
    </View>
  );
}

function SubHead({ children }: { children: string }) {
  const ui = useUI();
  return <Text style={[styles.label, styles.subhead, { fontFamily: ui.font, color: ui.color("ink-3"), backgroundColor: ui.color("field-soft"), borderTopColor: ui.color("hairline") }]}>{children}</Text>;
}

function Fold({ icon, label, open, onPress, testID }: { icon: IconName; label: string; open: boolean; onPress: () => void; testID?: string }) {
  const ui = useUI();
  return (
    <Pressable role="button" aria-expanded={open} onPress={onPress} testID={testID} style={({ pressed }) => [styles.fold, { borderTopColor: ui.color("hairline") }, pressed && { opacity: PRESS_OPACITY }]}>
      <ui.Icon name={icon} size={16} color={ui.color("ink-3")} />
      <Text style={[styles.body, styles.grow, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{label}</Text>
      <ui.Icon name={open ? "caret-up" : "caret-down"} size={14} color={ui.color("ink-3")} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "baseline", gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  cardTitle: { margin: 0, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1 },
  mark: { marginTop: 2, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  gap: { marginTop: 8 },
  label: { marginTop: 12, fontSize: 14, lineHeight: 20, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" },
  subhead: { marginTop: 0, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, borderTopWidth: 1 },
  edit: { marginTop: 4 },
  action: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  actions: { marginTop: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16 },
  primary: { height: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  error: { marginHorizontal: 16, marginBottom: 12, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  fold: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  passedList: { gap: 4, paddingHorizontal: 16, paddingBottom: 12 },
  readOnly: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
});
