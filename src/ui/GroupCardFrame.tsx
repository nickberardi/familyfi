"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";

import { GroupCardHeader } from "./GroupCardHeader";
import { useUI } from "./UIContext";

/**
 * A group card's frame, shared by every client: the card, and its header as the button that opens
 * and closes it, with a caret. What the card shows below the header, open or closed, is the caller's.
 */
export function GroupCardFrame({
  group,
  windows,
  timezone,
  now,
  open,
  onToggle,
  testID,
  children,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  open: boolean;
  onToggle: () => void;
  testID?: string;
  children?: ReactNode;
}) {
  const ui = useUI();
  const wide = useWindowDimensions().width >= 768;
  return (
    <View
      role="article"
      testID={testID ? `group-card-${testID}` : undefined}
      style={[
        styles.card,
        { backgroundColor: ui.color("card") },
        // Cards are outlined on wide screens, as on the web's md breakpoint.
        wide && { borderWidth: 1, borderColor: ui.color("hairline-card") },
      ]}
    >
      <Pressable
        role="button"
        aria-expanded={open}
        onPress={onToggle}
        testID={testID ? `group-header-${testID}` : undefined}
        style={styles.header}
      >
        <GroupCardHeader group={group} windows={windows} timezone={timezone} now={now} />
        <View aria-hidden style={styles.caret}>
          <ui.Icon name={open ? "caret-up" : "caret-down"} size={16} color={ui.color("ink-3")} />
        </View>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, width: "100%" },
  caret: { marginTop: 2, flexShrink: 0 },
});
