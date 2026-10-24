"use client";

import { StyleSheet, Text, View } from "react-native";

import { fromLockDnsRule, LOCK_DNS_COPY as COPY, lockDnsWrites, type LockDnsDraft } from "@/lib/lock-dns";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { EditorSection } from "./EditorSection";
import { RuleAppliesTo } from "./RuleAppliesTo";
import { RuleWritesList } from "./RuleEditorForm";
import { useUI } from "./UIContext";

/**
 * The built-in Lock DNS rule's page: what it blocks, what it applies to (all that can change),
 * and what saving that writes. Each client puts it under its own header and Save.
 */
export function LockDnsForm({
  rule,
  groups,
  networks,
  draft,
  edit,
  disabled = false,
}: {
  rule: Pick<Rule, "scope" | "groupIds" | "networkIds">;
  groups: Pick<Group, "id" | "name">[];
  /** The networks FamilyFi manages (`managedNetworks`), which it can cover whole. */
  networks: { id: string; name: string }[];
  /** What it applies to now, saved or not. */
  draft: LockDnsDraft;
  edit: (next: (draft: LockDnsDraft) => LockDnsDraft) => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const body = { fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") };
  const writes = lockDnsWrites(fromLockDnsRule(rule), draft);
  return (
    <View style={styles.form}>
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
  caution: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
});
