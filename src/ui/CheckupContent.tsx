"use client";

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  CHECKUP_COPY as COPY,
  checkupCopy,
  checkupSections,
  knownCheck,
  knownCheckupMessage,
  checkupSummary,
  driftRows,
  leftoverCopyNote,
  leftoverPolicyLine,
  protectionLine,
  protectionTitle,
  type CheckupFinding,
  type CheckupState,
} from "@/lib/checkup";
import type { IconName } from "@/lib/icons";
import { ruleHref, ruleToggleLabels } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { ExternalLink } from "./ExternalLink";
import { RuleMark } from "./RuleMark";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * Checkup's first card: FamilyFi's recommended protections, each the switch of a built-in rule, and
 * one button that turns on whichever are off. Edit opens the rule's own page.
 */
export function ProtectionCard({
  rules,
  groups,
  networks = [],
  disabled = false,
  onToggle,
  onTurnOnAll,
}: {
  /** `recommendedRules(...)`. */
  rules: Rule[];
  groups: Pick<Group, "id" | "name">[];
  /** The site's networks, to name those a protection covers whole. */
  networks?: { id: string; name: string }[];
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
        <Row
          key={rule.id}
          mark={
            <View style={rule.enabled ? null : styles.faded}>
              <RuleMark rule={rule} />
            </View>
          }
          testID={`checkup-protection-${rule.id}`}
        >
          <View style={styles.grow}>
            <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{protectionTitle(rule)}</Text>
            <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>
              {protectionLine(rule, groups, networks)}
            </Text>
            {rule.builtIn !== "quarantine" ? (
              <ui.Link href={ruleHref(rule)} testID={`checkup-edit-${rule.id}`}>
                <Text style={[styles.action, styles.edit, { fontFamily: ui.font, color: ui.color("accent") }]}>{COPY.protection.edit}</Text>
              </ui.Link>
            ) : null}
          </View>
          <ui.Toggle label={protectionTitle(rule)} on={rule.enabled} onToggle={() => onToggle(rule)} disabled={disabled} {...ruleToggleLabels(rule)} testID={`checkup-toggle-${rule.id}`} />
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
 * purpose, then the checks that passed. FamilyFi only reads; each finding says how to change it. The
 * one exception is leftover FamilyFi policies, which `onRemovePolicies` removes once its caller has
 * had the administrator confirm; without it the card only lists them. A FamilyFi rule changed in
 * UniFi that sync could not change back offers `onPutBack`, which asks for a sync now.
 */
export function NetworkCheckupCard({
  checkup,
  checking = false,
  disabled = false,
  now,
  onCheckNow,
  onDismiss,
  onRemovePolicies,
  onPutBack,
}: {
  checkup: CheckupState | null;
  checking?: boolean;
  disabled?: boolean;
  now?: Date;
  onCheckNow: () => void;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
  /** Ask the administrator to confirm, then remove these leftover policies. */
  onRemovePolicies?: (policyIds: string[]) => void;
  /** Sync now, to put back a rule changed in UniFi. */
  onPutBack?: () => void;
}) {
  const ui = useUI();
  const [showPassed, setShowPassed] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const sections = checkupSections(checkup ?? { findings: [] });
  // A check newer than this build has no name here: leave it out.
  const passed = (checkup?.passed ?? []).filter((check) => knownCheck(check));
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
        <FindingRow key={finding.id} finding={finding} initiallyOpen={index === 0} disabled={disabled} onDismiss={onDismiss} onRemovePolicies={onRemovePolicies} />
      ))}
      {sections.notes.length ? <SubHead>{COPY.network.notes(sections.notes.length)}</SubHead> : null}
      {sections.notes.map((finding) => (
        <FindingRow key={finding.id} finding={finding} disabled={disabled} onDismiss={onDismiss} onPutBack={onPutBack} />
      ))}
      {sections.dismissed.length ? (
        <>
          <Fold icon="x" label={COPY.network.dismissedCount(sections.dismissed.length)} open={showDismissed} onPress={() => setShowDismissed(!showDismissed)} testID="checkup-dismissed" />
          {showDismissed ? sections.dismissed.map((finding) => <FindingRow key={finding.id} finding={finding} disabled={disabled} onDismiss={onDismiss} onRemovePolicies={onRemovePolicies} onPutBack={onPutBack} />) : null}
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
  onRemovePolicies,
  onPutBack,
}: {
  finding: CheckupFinding;
  initiallyOpen?: boolean;
  disabled: boolean;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
  onRemovePolicies?: (policyIds: string[]) => void;
  onPutBack?: () => void;
}) {
  const ui = useUI();
  const [open, setOpen] = useState(initiallyOpen);
  if (finding.check === "leftover_policies") return <LeftoverRow finding={finding} disabled={disabled} onDismiss={onDismiss} onRemovePolicies={onRemovePolicies} />;
  if (finding.check === "gateway_drift" && finding.details.drift) return <DriftRow finding={finding} disabled={disabled} onDismiss={onDismiss} onPutBack={onPutBack} />;
  const note = finding.kind === "note";
  const body = [styles.body, { fontFamily: ui.font }];
  const action = [styles.action, { fontFamily: ui.font, color: ui.color("accent") }];
  const dismiss = (
    <Pressable role="button" aria-disabled={disabled} disabled={disabled} onPress={() => onDismiss(finding, !finding.dismissed)} testID={`checkup-dismiss-${finding.id}`}>
      <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("ink-3") }]}>
        {finding.dismissed ? COPY.network.restore : note ? COPY.network.intended : COPY.network.dismiss}
      </Text>
    </Pressable>
  );
  // A check newer than this build has no copy here: the server's English line, and a nudge to update.
  if (!knownCheckupMessage(finding.message)) {
    return (
      <Row icon="warning" tone={note || finding.dismissed ? "muted" : "paused"} testID={`checkup-finding-${finding.id}`}>
        <View style={styles.grow}>
          <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{finding.message.text}</Text>
          <Text style={[body, { color: ui.color("ink-3") }]}>{COPY.network.unknown}</Text>
          <View style={styles.actions}>{dismiss}</View>
        </View>
      </Row>
    );
  }
  const copy = checkupCopy(finding);
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
          {dismiss}
        </View>
      </View>
    </Row>
  );
}

/** Leftover FamilyFi policies: each with a tick, all ticked to start, and Remove for the ticked ones. */
function LeftoverRow({
  finding,
  disabled,
  onDismiss,
  onRemovePolicies,
}: {
  finding: CheckupFinding;
  disabled: boolean;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
  onRemovePolicies?: (policyIds: string[]) => void;
}) {
  const ui = useUI();
  const copy = checkupCopy(finding);
  const policies = finding.details.policies ?? [];
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const ticked = policies.filter((policy) => !unticked.has(policy.id)).map((policy) => policy.id);
  const body = [styles.body, { fontFamily: ui.font }];
  const text = COPY.network.leftover;
  const toggle = (id: string) => {
    const next = new Set(unticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUnticked(next);
  };
  const removeOff = disabled || ticked.length === 0;
  return (
    <Row icon={copy.icon} tone={finding.dismissed ? "muted" : "paused"} testID={`checkup-finding-${finding.id}`}>
      <View style={styles.grow}>
        <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{copy.title}</Text>
        <Text style={[body, { color: ui.color("ink-2") }]}>{copy.seen}</Text>
        <Text style={[body, styles.gap, { color: ui.color("ink-3") }]}>{copy.why}</Text>
        <View style={[styles.policies, { borderColor: ui.color("hairline-card") }]}>
          {policies.map((policy, index) => {
            const on = !unticked.has(policy.id);
            return (
              <Pressable
                key={policy.id}
                role="checkbox"
                aria-checked={on}
                aria-label={policy.name}
                disabled={disabled || !onRemovePolicies}
                onPress={() => toggle(policy.id)}
                testID={`checkup-policy-${policy.id}`}
                style={({ pressed }) => [styles.policy, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }, pressed && { opacity: PRESS_OPACITY }]}
              >
                {onRemovePolicies ? (
                  <View aria-hidden style={[styles.tick, on ? { backgroundColor: ui.color("accent") } : { borderWidth: 1.5, borderColor: ui.color("line") }]}>
                    {on ? <Text style={[styles.tickMark, { color: ui.color("ink-on-fill") }]}>✓</Text> : null}
                  </View>
                ) : null}
                <View style={styles.grow}>
                  <Text style={[body, styles.strong, { color: ui.color("ink") }]}>{policy.name}</Text>
                  <Text style={[body, { color: ui.color("ink-3") }]}>{leftoverPolicyLine(policy)}</Text>
                  {leftoverCopyNote(policy) ? <Text style={[body, styles.copyNote, { color: ui.color(policy.enabled ? "paused" : "ink-3") }]}>{leftoverCopyNote(policy)}</Text> : null}
                </View>
                <Text style={[body, styles.strong, { color: ui.color(policy.enabled ? "paused" : "ink-3") }]}>{policy.enabled ? text.on : text.off}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.actions, styles.leftoverActions]}>
          {onRemovePolicies ? (
            <Pressable
              role="button"
              aria-disabled={removeOff}
              disabled={removeOff}
              onPress={() => onRemovePolicies(ticked)}
              testID="checkup-remove-policies"
              style={({ pressed }) => [styles.danger, { borderColor: ui.color("danger") }, removeOff && { opacity: 0.5 }, pressed && !removeOff && { opacity: PRESS_OPACITY }]}
            >
              <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("danger") }]}>{text.remove(ticked.length)}</Text>
            </Pressable>
          ) : null}
          <Pressable role="button" aria-disabled={disabled} disabled={disabled} onPress={() => onDismiss(finding, !finding.dismissed)} testID={`checkup-dismiss-${finding.id}`}>
            <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{finding.dismissed ? COPY.network.restore : text.keep(policies.length)}</Text>
          </Pressable>
        </View>
      </View>
    </Row>
  );
}

/**
 * A FamilyFi rule someone changed in UniFi: what FamilyFi has beside what was on the gateway. Sync
 * changes it back on its own; Put it back shows only while that keeps failing.
 */
function DriftRow({
  finding,
  disabled,
  onDismiss,
  onPutBack,
}: {
  finding: CheckupFinding;
  disabled: boolean;
  onDismiss: (finding: CheckupFinding, dismissed: boolean) => void;
  onPutBack?: () => void;
}) {
  const ui = useUI();
  const copy = checkupCopy(finding);
  const drift = finding.details.drift!;
  const text = COPY.network.drift;
  const body = [styles.body, { fontFamily: ui.font }];
  const failing = !drift.putBack;
  const cell = (value: string, changed = false) => <Text style={[body, styles.cell, { color: ui.color(changed ? "paused" : "ink-2") }, changed && styles.strong]}>{value}</Text>;
  return (
    <Row icon={copy.icon} tone={finding.dismissed || !failing ? "muted" : "paused"} testID={`checkup-finding-${finding.id}`}>
      <View style={styles.grow}>
        <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{copy.title}</Text>
        <Text style={[body, { color: ui.color("ink-2") }]}>{copy.seen}</Text>
        <Text style={[body, styles.gap, { color: ui.color("ink-3") }]}>{copy.why}</Text>
        <View style={[styles.policies, { borderColor: ui.color("hairline-card") }]} testID={`checkup-drift-${finding.id}`}>
          <View style={[styles.driftRow, { backgroundColor: ui.color("field-soft") }]}>
            <Text style={[body, styles.driftLabel]} />
            {cell(text.inFamilyFi)}
            {cell(failing ? text.onGateway : text.wasOnGateway)}
          </View>
          {driftRows(drift).map((row) => (
            <View key={row.label} style={[styles.driftRow, { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}>
              <Text style={[body, styles.driftLabel, styles.strong, { color: ui.color("ink") }]}>{row.label}</Text>
              {cell(row.familyfi)}
              {cell(row.gateway, true)}
            </View>
          ))}
        </View>
        <View style={[styles.actions, styles.leftoverActions]}>
          {failing && onPutBack ? (
            <Pressable
              role="button"
              aria-disabled={disabled}
              disabled={disabled}
              onPress={onPutBack}
              testID={`checkup-put-back-${finding.id}`}
              style={({ pressed }) => [styles.solid, { backgroundColor: ui.color("accent") }, disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
            >
              <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("ink-on-fill") }]}>{text.putBack}</Text>
            </Pressable>
          ) : null}
          {copy.show ? (
            <ui.Link href={copy.show.href}>
              <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("accent") }]}>{copy.show.label}</Text>
            </ui.Link>
          ) : null}
          <Pressable role="button" aria-disabled={disabled} disabled={disabled} onPress={() => onDismiss(finding, !finding.dismissed)} testID={`checkup-dismiss-${finding.id}`}>
            <Text style={[styles.action, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{finding.dismissed ? COPY.network.restore : COPY.network.dismiss}</Text>
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

/** A row led by a finding's tinted icon (`icon` and `tone`), or by a mark of the caller's own (`mark`). */
function Row({
  icon,
  tone = "accent",
  mark,
  testID,
  children,
}: {
  icon?: IconName;
  tone?: keyof typeof MARK_TONE;
  mark?: ReactNode;
  testID?: string;
  children: ReactNode;
}) {
  const ui = useUI();
  const colors = MARK_TONE[tone];
  return (
    <View style={[styles.row, { borderTopColor: ui.color("hairline") }]} testID={testID}>
      {mark ?? (
        <View aria-hidden style={[styles.mark, { backgroundColor: ui.color(colors.fill) }]}>
          {icon ? <ui.Icon name={icon} size={17} color={ui.color(colors.ink)} /> : null}
        </View>
      )}
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
  faded: { opacity: 0.4 },
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
  policies: { marginTop: 10, borderRadius: 9, borderWidth: 1, overflow: "hidden" },
  policy: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  tick: { marginTop: 1, width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  tickMark: { fontSize: 12, lineHeight: 14, fontWeight: "700" },
  strong: { fontWeight: "600" },
  copyNote: { marginTop: 2 },
  leftoverActions: { marginTop: 12 },
  driftRow: { flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  driftLabel: { width: 72, flexShrink: 0 },
  cell: { flex: 1, minWidth: 0 },
  solid: { minHeight: 36, paddingHorizontal: 14, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  danger: { minHeight: 36, paddingHorizontal: 14, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
