"use client";

import { StyleSheet, Text, View } from "react-native";

import { LOCK_DNS_COPY as COPY, lockDnsWrites, toggleLockDnsGroup } from "@/lib/lock-dns";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { Chip, ChipGroup } from "./Chips";
import { EditorSection } from "./EditorSection";
import { RuleWritesList } from "./RuleEditorForm";
import { useUI } from "./UIContext";

/**
 * The built-in Lock DNS rule's page: what it blocks, the groups it covers (all that can change),
 * and what saving them writes. Each client puts it under its own header and Save.
 */
export function LockDnsForm({
  rule,
  groups,
  groupIds,
  onChange,
  disabled = false,
}: {
  rule: Pick<Rule, "groupIds">;
  groups: Pick<Group, "id" | "name">[];
  /** The groups picked now, saved or not. */
  groupIds: string[];
  onChange: (groupIds: string[]) => void;
  disabled?: boolean;
}) {
  const ui = useUI();
  const body = { fontFamily: ui.font, fontSize: 14, lineHeight: 20, color: ui.color("ink-2") };
  const writes = lockDnsWrites(rule.groupIds, groupIds);
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

      <EditorSection title={COPY.appliesTo.title} note={COPY.appliesTo.note}>
        <ChipGroup label={COPY.appliesTo.label}>
          {groups.map((group) => (
            <Chip
              key={group.id}
              on={groupIds.includes(group.id)}
              onPress={() => onChange(toggleLockDnsGroup(groupIds, group.id))}
              disabled={disabled}
              testID={`lock-dns-group-${group.id}`}
            >
              {group.name}
            </Chip>
          ))}
        </ChipGroup>
        <Text style={body}>{COPY.appliesTo.things}</Text>
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
  caution: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
});
