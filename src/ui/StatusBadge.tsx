"use client";

import { StyleSheet, Text } from "react-native";

import { groupBadge, type GroupStatusParts } from "@/lib/group-actions";

import { tokenOf, useUI } from "./UIContext";

/**
 * A group's state beside its name: green "Online" or red "Blocked" (`groupBadge`), round and
 * tinted. A state badge, so never the grey square `Tag`, which names a kind of thing.
 */
export function StatusBadge({ badge, testID }: { badge: GroupStatusParts["badge"]; testID?: string }) {
  const ui = useUI();
  const style = groupBadge(badge);
  return (
    <Text testID={testID} style={[styles.badge, { fontFamily: ui.font, color: ui.color(tokenOf(style.ink)), backgroundColor: ui.color(tokenOf(style.fill)) }]}>
      {style.label}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: { flexShrink: 0, overflow: "hidden", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
