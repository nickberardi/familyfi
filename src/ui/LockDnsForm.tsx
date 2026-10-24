"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { fromLockDnsRule, LOCK_DNS_COPY as COPY, lockDnsOpenLabel, lockDnsWrites, type LockDnsDraft } from "@/lib/lock-dns";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { EditorSection } from "./EditorSection";
import { RuleAppliesTo } from "./RuleAppliesTo";
import { RuleWritesList } from "./RuleEditorForm";
import { useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * The built-in Lock DNS rule's page: what it blocks, what it applies to, its experimental iCloud
 * Private Relay switch (all that can change), the DNS it leaves open, and what saving writes. Each client puts it under its own header and Save.
 */
export function LockDnsForm({
  rule,
  groups,
  networks,
  draft,
  edit,
  error = "",
  disabled = false,
}: {
  rule: Pick<Rule, "scope" | "groupIds" | "networkIds" | "blockPrivateRelay" | "openDns">;
  groups: Pick<Group, "id" | "name">[];
  /** The networks FamilyFi manages (`managedNetworks`), which it can cover whole. */
  networks: { id: string; name: string }[];
  /** What it applies to and its Private Relay switch now, saved or not. */
  draft: LockDnsDraft;
  edit: (next: (draft: LockDnsDraft) => LockDnsDraft) => void;
  /** Why the last save was refused (`validateLockDnsDraft`), or empty. */
  error?: string;
  disabled?: boolean;
}) {
  const ui = useUI();
  const body = { fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") };
  const writes = lockDnsWrites(fromLockDnsRule(rule), draft);
  return (
    <View style={styles.form}>
      {error ? (
        <Text role="alert" style={[body, styles.caution, { backgroundColor: ui.color("danger-fill"), color: ui.color("danger") }]} testID="lock-dns-error">
          {error}
        </Text>
      ) : null}
      <EditorSection title={COPY.blocks.title} note={COPY.blocks.note}>
        <View role="list" style={styles.items}>
          {COPY.blocks.items.map((item) => (
            <View key={item.title} role="listitem" style={styles.item}>
              <View style={styles.icon}>
                <ui.Icon name="shield-check" size={18} color={ui.color("accent")} />
              </View>
              <View style={styles.grow}>
                <Text style={[body, styles.itemTitle, { color: ui.color("ink") }]}>{item.title}</Text>
                <Text style={body}>{item.body}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[body, styles.caution, { backgroundColor: ui.color("paused-fill") }]} testID="lock-dns-caution">
          {COPY.blocks.caution}
        </Text>
      </EditorSection>

      <RuleAppliesTo draft={draft} groups={groups} networks={networks} edit={edit} note={COPY.appliesTo.note} disabled={disabled} testID="lock-dns">
        {draft.scope === "group" ? <Text style={body}>{COPY.appliesTo.things}</Text> : null}
      </RuleAppliesTo>

      <EditorSection title={COPY.privateRelay.title} note={COPY.privateRelay.note}>
        <View style={styles.toggleRow}>
          <View style={styles.grow}>
            <Text style={[body, styles.itemTitle, { color: ui.color("ink") }]}>{COPY.privateRelay.label}</Text>
            <Text style={body}>{COPY.privateRelay.body}</Text>
          </View>
          <ui.Toggle
            label={COPY.privateRelay.label}
            on={draft.blockPrivateRelay}
            onToggle={() => edit((current) => ({ ...current, blockPrivateRelay: !current.blockPrivateRelay }))}
            disabled={disabled}
            testID="lock-dns-private-relay"
          />
        </View>
      </EditorSection>

      <EditorSection title={COPY.open.title} note={COPY.open.note}>
        {rule.openDns.length ? (
          <View role="list" style={styles.items} testID="lock-dns-open">
            {rule.openDns.map((entry, index) => (
              <View key={`${entry.source}-${entry.name}-${entry.host}-${index}`} role="listitem" style={styles.item}>
                <View style={styles.icon}>
                  <ui.Icon name="check-circle" size={18} color={ui.color("ink-2")} />
                </View>
                <View style={styles.grow}>
                  <Text style={[body, styles.itemTitle, { color: ui.color("ink") }]}>{lockDnsOpenLabel(entry)}</Text>
                  {entry.host ? <Text style={body}>{entry.host}</Text> : null}
                  {entry.addresses.length ? <Text style={[body, { fontFamily: MONO }]}>{entry.addresses.join(", ")}</Text> : <Text style={body}>{COPY.open.notLookedUp}</Text>}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={body}>{COPY.open.none}</Text>
        )}
      </EditorSection>

      <EditorSection title={COPY.writes.title} note={COPY.writes.note}>
        {writes.length ? <RuleWritesList writes={writes} /> : <Text style={body}>{COPY.writes.none}</Text>}
      </EditorSection>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  items: { gap: 12 },
  item: { flexDirection: "row", gap: 12 },
  icon: { paddingTop: 2 },
  grow: { flex: 1, minWidth: 0 },
  itemTitle: { fontWeight: "600", lineHeight: 21 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  caution: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
});
