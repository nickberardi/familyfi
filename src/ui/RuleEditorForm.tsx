"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { FAMILYFI_POLICY_PREFIX, MAX_POLICY_NAME } from "@/lib/policy-names";
import {
  KIND_NOTE,
  RULE_EDITOR_COPY as COPY,
  RULE_KINDS,
  addDomain,
  addWindow,
  canAddWindow,
  changeKind,
  changeMode,
  removeDomain,
  removeWindow,
  ruleEditorState,
  toggleRuleGroup,
  toggleRuleNetwork,
  toggleWindowDay,
  undoRemoveWindow,
  updateWindow,
  windowTimeLabels,
  windowTitle,
  type EditorDraft,
} from "@/lib/rule-editor";
import type { RuleWrite } from "@/lib/rule-writes";
import { MAX_RULE_NAME, MAX_WINDOW_NAME, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { CatalogPicker } from "./CatalogPicker";
import { Chip, ChipGroup } from "./Chips";
import { EditorSection } from "./EditorSection";
import { RuleBar } from "./RuleBar";
import { RuleNameField } from "./RuleNameField";
import { RuleWindowFrame } from "./RuleWindowFrame";
import { PRESS_OPACITY, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

type Edit = (next: (draft: EditorDraft) => EditorDraft) => void;

/**
 * The rule editor's form, shared by every client: its name and UniFi names, what it blocks, when,
 * for whom, and what saving writes. Each client wraps it in its own page or sheet with the save
 * and delete actions; `edit` applies an edit to the draft and clears the error.
 */
export function RuleEditorForm({
  draft,
  saved,
  groups,
  networks,
  request,
  error,
  disabled = false,
  edit,
  onError,
}: {
  draft: EditorDraft;
  saved: Rule | null;
  groups: Pick<Group, "id" | "name">[];
  /** The networks FamilyFi manages (`managedNetworks`), which a rule can cover whole. */
  networks: { id: string; name: string }[];
  request: ApiRequest;
  error: string;
  /** True while the household is stale, so nothing can be changed. */
  disabled?: boolean;
  edit: Edit;
  onError: (message: string) => void;
}) {
  const ui = useUI();
  const state = ruleEditorState(draft, saved);
  const text = (size: number, lineHeight: number) => ({ fontFamily: ui.font, fontSize: size, lineHeight });
  const note = [text(14, 20), { color: ui.color("ink-2") }];
  const set = (patch: Partial<EditorDraft>) => edit((current) => ({ ...current, ...patch }));

  return (
    <View style={styles.form}>
      {error ? (
        <Text role="alert" style={[text(14, 21), styles.error, { backgroundColor: ui.color("danger-fill"), color: ui.color("danger") }]} testID="rule-error">
          {error}
        </Text>
      ) : null}

      <EditorSection title={COPY.name.title} note={COPY.name.note}>
        <RuleNameField label={COPY.name.label}>
          <ui.TextField
            label={COPY.name.label}
            value={draft.name}
            onChange={(name) => set({ name })}
            placeholder={COPY.name.placeholder}
            maxLength={MAX_RULE_NAME}
            disabled={disabled}
            testID="rule-name"
          />
        </RuleNameField>
        <PolicyNames names={state.policyNames} generated={draft.useGeneratedName} onToggle={() => set({ useGeneratedName: !draft.useGeneratedName })} disabled={disabled} />
      </EditorSection>

      <EditorSection title={COPY.blocks.title} note={KIND_NOTE[draft.kind]}>
        <ui.Segmented
          name={COPY.blocks.title}
          value={draft.kind}
          segments={RULE_KINDS.map((item) => ({ ...item, disabled: Boolean(saved) && item.value !== draft.kind }))}
          onChange={(kind) => edit((current) => changeKind(current, kind as EditorDraft["kind"]))}
          disabled={disabled}
          testID="rule-kind"
        />
        {saved ? <Text style={note}>{COPY.blocks.savedKind}</Text> : null}
        {draft.kind === "category" || draft.kind === "app" ? (
          <CatalogPicker key={draft.kind} kind={draft.kind} targetIds={draft.targetIds} onChange={(targetIds) => set({ targetIds })} request={request} disabled={disabled} />
        ) : null}
        {draft.kind === "domain" ? <DomainPicker draft={draft} edit={edit} onError={onError} disabled={disabled} /> : null}
      </EditorSection>

      <EditorSection title={COPY.when.title} note={COPY.when.note}>
        <ui.Segmented
          name={COPY.when.title}
          value={draft.mode}
          segments={[
            { value: "always", label: COPY.when.always },
            { value: "scheduled", label: COPY.when.scheduled },
          ]}
          onChange={(mode) => edit((current) => changeMode(current, mode as EditorDraft["mode"]))}
          disabled={disabled}
          fit
          testID="rule-mode"
        />
        {!state.scheduled ? (
          <Text style={note}>{COPY.when.alwaysNote}</Text>
        ) : (
          <>
            <RuleBar rule={{ kind: draft.kind, mode: "scheduled", windows: state.windows }} />
            {draft.windows.map((window) => {
              const index = state.windows.indexOf(window);
              if (window.removed) {
                return (
                  <View key={window.key} style={[styles.removed, { backgroundColor: ui.color("field-soft") }]}>
                    <Text style={[text(14, 21), styles.grow, { color: ui.color("ink") }]}>
                      <Text style={styles.struck}>{window.name || "Window"}</Text> · {COPY.when.removed}
                    </Text>
                    <TextButton label={COPY.when.undo} onPress={() => edit((current) => undoRemoveWindow(current, window.key))} disabled={disabled} />
                  </View>
                );
              }
              const times = windowTimeLabels(draft.kind);
              return (
                <RuleWindowFrame key={window.key} legend={windowTitle(window, index)} testID={`rule-window-${index}`}>
                  <View style={styles.windowHead}>
                    <View style={styles.grow}>
                      <ui.TextField
                        label={`Window ${index + 1} name`}
                        value={window.name}
                        onChange={(name) => edit((current) => updateWindow(current, window.key, { name }))}
                        placeholder={`Window ${index + 1} name`}
                        maxLength={MAX_WINDOW_NAME}
                        disabled={disabled}
                        testID={`rule-window-${index}-name`}
                      />
                    </View>
                    {saved && !window.id ? <Text style={[text(14, 21), { color: ui.color("on") }]}>{COPY.when.newWindow}</Text> : null}
                    {state.windows.length > 1 ? (
                      <Pressable
                        role="button"
                        aria-label={`Remove ${window.name || `window ${index + 1}`}`}
                        aria-disabled={disabled}
                        disabled={disabled}
                        onPress={() => edit((current) => removeWindow(current, window.key))}
                        testID={`rule-window-${index}-remove`}
                        style={styles.remove}
                      >
                        <Text style={[text(17, 25.5), { color: ui.color("danger") }]}>×</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.windowControls}>
                    <ui.TimeField
                      label={times.start}
                      value={window.start}
                      onChange={(start) => edit((current) => updateWindow(current, window.key, { start }))}
                      disabled={disabled}
                      testID={`rule-window-${index}-start`}
                    />
                    <ui.TimeField
                      label={times.end}
                      value={window.end}
                      onChange={(end) => edit((current) => updateWindow(current, window.key, { end }))}
                      disabled={disabled}
                      testID={`rule-window-${index}-end`}
                    />
                    <ui.DayPicker
                      days={window.days}
                      onToggle={(day) => edit((current) => toggleWindowDay(current, window.key, day))}
                      disabled={disabled}
                      testID={`rule-window-${index}-day`}
                    />
                  </View>
                  {state.windows.length === 1 ? <Text style={note}>{COPY.when.lastWindow}</Text> : null}
                </RuleWindowFrame>
              );
            })}
            {state.overlaps.length ? (
              <Text role="status" style={[text(14, 20), styles.overlap, { backgroundColor: ui.color("paused-fill"), color: ui.color("ink") }]}>
                {state.overlaps.join(" ")} {COPY.when.overlap}
              </Text>
            ) : null}
            <View style={styles.addRow}>
              <TextButton label={COPY.when.add} onPress={() => edit(addWindow)} disabled={disabled || !canAddWindow(draft)} testID="rule-add-window" />
              <Text style={[text(14, 21), { color: ui.color("ink-2") }]}>{COPY.when.addNote}</Text>
            </View>
          </>
        )}
      </EditorSection>

      <EditorSection title={COPY.appliesTo.title} note={COPY.appliesTo.note}>
        {networks.length ? (
          <ui.Segmented
            name={COPY.appliesTo.title}
            value={draft.scope}
            segments={[
              { value: "group", label: COPY.appliesTo.groups, disabled: Boolean(saved) && draft.scope !== "group" },
              { value: "network", label: COPY.appliesTo.networks, disabled: draft.kind === "internet" || (Boolean(saved) && draft.scope !== "network") },
            ]}
            onChange={(scope) => set({ scope: scope as EditorDraft["scope"] })}
            disabled={disabled}
            fit
            testID="rule-scope"
          />
        ) : null}
        {draft.kind === "internet" ? <Text style={note}>{COPY.appliesTo.internetNote}</Text> : null}
        {draft.scope === "group" ? (
          <ChipGroup label={COPY.appliesTo.groupsLabel}>
            {groups.map((group) => (
              <Chip
                key={group.id}
                on={draft.groupIds.includes(group.id)}
                onPress={() => edit((current) => toggleRuleGroup(current, group.id))}
                disabled={disabled}
                testID={`rule-group-${group.id}`}
              >
                {group.name}
              </Chip>
            ))}
          </ChipGroup>
        ) : (
          <ChipGroup label={COPY.appliesTo.networksLabel}>
            {networks.map((network) => (
              <Chip
                key={network.id}
                on={draft.networkIds.includes(network.id)}
                onPress={() => edit((current) => toggleRuleNetwork(current, network.id))}
                disabled={disabled}
                testID={`rule-network-${network.id}`}
              >
                {network.name}
              </Chip>
            ))}
          </ChipGroup>
        )}
      </EditorSection>

      <EditorSection title={COPY.writes.title} note={COPY.writes.note}>
        <Writes writes={state.writes} />
      </EditorSection>
    </View>
  );
}

function TextButton({ label, onPress, disabled = false, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const ui = useUI();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [disabled && { opacity: 0.5 }, pressed && !disabled && { opacity: PRESS_OPACITY }]}
    >
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("accent") }}>{label}</Text>
    </Pressable>
  );
}

/** The names UniFi will show, one per window, with the FamilyFi prefix set apart and each name's length. */
function PolicyNames({ names, generated, onToggle, disabled }: { names: string[]; generated: boolean; onToggle: () => void; disabled: boolean }) {
  const ui = useUI();
  const many = names.length > 1;
  const mono = { fontFamily: MONO, fontSize: 14, lineHeight: 21 };
  return (
    <View style={[styles.policyBox, { backgroundColor: ui.color("field-soft") }]} testID="rule-policy-names">
      <View style={styles.policyHead}>
        <Text style={[styles.grow, { fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("ink") }]}>
          {many ? COPY.policyNames.many : COPY.policyNames.one}
        </Text>
        <TextButton label={generated ? COPY.policyNames.useRuleName : COPY.policyNames.useGenerated} onPress={onToggle} disabled={disabled} />
      </View>
      <View role="list" style={styles.policyList}>
        {names.map((name, index) => (
          <View key={index} role="listitem" style={styles.policyRow}>
            <Text style={[mono, styles.grow, { color: ui.color("ink") }]}>
              <Text style={{ color: ui.color("ink-3") }}>{FAMILYFI_POLICY_PREFIX}</Text>
              {name.slice(FAMILYFI_POLICY_PREFIX.length)}
            </Text>
            <Text style={[mono, { color: ui.color("ink-3") }]}>
              {name.length} / {MAX_POLICY_NAME}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.policyNote, { fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") }]}>
        {many ? COPY.policyNames.manyNote : COPY.policyNames.oneNote}
      </Text>
    </View>
  );
}

/** A Websites rule's domains: each one picked, and a field to add another. */
function DomainPicker({ draft, edit, onError, disabled }: { draft: EditorDraft; edit: Edit; onError: (message: string) => void; disabled: boolean }) {
  const ui = useUI();
  const [domain, setDomain] = useState("");
  const mono = { fontFamily: MONO, fontSize: 14, lineHeight: 21 };
  function add() {
    const added = addDomain(draft, domain);
    if (added.error) {
      onError(added.error);
      return;
    }
    edit((current) => ({ ...current, domains: added.draft.domains }));
    setDomain("");
  }
  return (
    <View style={styles.domainPicker}>
      <View style={[styles.domainBox, { borderColor: ui.color("input-line"), backgroundColor: ui.color("card") }]}>
        {draft.domains.map((item) => (
          <View key={item} style={[styles.domain, { backgroundColor: ui.color("field") }]} testID={`rule-domain-${item}`}>
            <Text style={[mono, { color: ui.color("ink") }]}>{item}</Text>
            <Pressable
              role="button"
              aria-label={`Remove ${item}`}
              aria-disabled={disabled}
              disabled={disabled}
              onPress={() => edit((current) => removeDomain(current, item))}
            >
              <Text style={[mono, { color: ui.color("danger") }]}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={styles.domainField}>
          <ui.TextField label={COPY.domains.label} value={domain} onChange={setDomain} onSubmit={add} placeholder={COPY.domains.placeholder} mono disabled={disabled} testID="rule-domain-add" />
        </View>
      </View>
      <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") }}>{COPY.domains.note}</Text>
    </View>
  );
}

const VERB_STYLE: Record<RuleWrite["verb"], { fill: string; ink: string }> = {
  NEW: { fill: "on-tint", ink: "on" },
  CHANGE: { fill: "accent-fill", ink: "accent" },
  DELETE: { fill: "danger-fill", ink: "danger" },
  KEEP: { fill: "field", ink: "ink-3" },
};

/** What saving writes to UniFi, policy by policy. */
function Writes({ writes }: { writes: RuleWrite[] }) {
  const ui = useUI();
  return (
    <View role="list" testID="rule-writes">
      {writes.map((write, index) => (
        <View
          key={`${write.verb}:${write.name}:${index}`}
          role="listitem"
          style={[styles.write, index > 0 && { borderTopWidth: 1, borderTopColor: ui.color("hairline") }]}
        >
          <Text style={[styles.verb, { fontFamily: ui.font, backgroundColor: ui.color(VERB_STYLE[write.verb].fill), color: ui.color(VERB_STYLE[write.verb].ink) }]}>
            {write.verb}
          </Text>
          <View style={styles.grow}>
            <Text
              style={[
                { fontFamily: MONO, fontSize: 14, lineHeight: 21, color: ui.color("ink") },
                write.verb === "DELETE" && styles.struck,
              ]}
            >
              {write.name}
            </Text>
            <Text style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, color: ui.color("ink-2") }}>{write.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  error: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  grow: { flex: 1, minWidth: 0 },
  struck: { textDecorationLine: "line-through" },
  removed: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  windowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  remove: { width: 28, height: 28, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  windowControls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  overlap: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  policyBox: { borderRadius: 9, padding: 12 },
  policyHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  policyList: { marginTop: 8, gap: 4 },
  policyRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  policyNote: { marginTop: 8 },
  domainPicker: { gap: 8 },
  domainBox: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, borderRadius: 9, borderWidth: 1, padding: 8 },
  domain: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  domainField: { minWidth: 180, flex: 1 },
  write: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  verb: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 0.3, overflow: "hidden" },
});
