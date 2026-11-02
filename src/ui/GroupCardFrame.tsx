"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { InternetWindow } from "@/lib/rule-windows";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { CardButton, CardTextButton, type ZoneAction } from "./CardActions";
import { GROUP_TILE_INSET, GroupCardHeader } from "./GroupCardHeader";
import { useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";
import { useWide } from "./use-wide";

/**
 * A group card's frame, shared by every client: the card, and its header as the button that opens
 * and closes it. Closed, the header shows a caret. Open, the group's one button (`action`: Block,
 * Unblock or Resume) takes the caret's corner, with More time under the status line while a timed
 * block or unblock lasts (`more`); the caller then offers its own way to close. At large text sizes
 * the button would cover the name and badge, so it goes under the header instead. What the card shows
 * below the header, open or closed, is the caller's.
 */
export function GroupCardFrame({
  group,
  rules,
  windows,
  timezone,
  now,
  open,
  onToggle,
  action = null,
  more = null,
  testID,
  children,
}: {
  group: Group;
  rules: Rule[];
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  open: boolean;
  onToggle: () => void;
  action?: ZoneAction | null;
  more?: ZoneAction | null;
  testID?: string;
  children?: ReactNode;
}) {
  const ui = useUI();
  const wide = useWide();
  const largeText = useLargeText();
  const corner = open && action && !largeText;
  const under = open && action && largeText;
  const inset = group.kind === "things" ? THINGS_TEXT_INSET : HEADER_PAD;
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
        style={[styles.header, corner ? styles.roomForAction : null]}
      >
        <GroupCardHeader group={group} rules={rules} windows={windows} timezone={timezone} now={now} />
        {corner ? null : (
          <View aria-hidden style={styles.caret}>
            <ui.Icon name={open ? "caret-up" : "caret-down"} size={16} color={ui.color("ink-3")} />
          </View>
        )}
      </Pressable>
      {/* Beside the header rather than in it, since a button cannot sit inside the header's button. */}
      {corner ? (
        <View style={styles.action}>
          <CardButton action={{ ...action, strong: true }} />
        </View>
      ) : null}
      {under ? (
        <View style={[styles.under, { paddingLeft: inset }]}>
          <CardButton action={{ ...action, strong: true }} />
        </View>
      ) : null}
      {open && more ? (
        <View style={[styles.more, under ? styles.afterUnder : null, { paddingLeft: inset }]}>
          <CardTextButton action={more} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const HEADER_PAD = 18;
/** Where a things card's words start: past its monogram tile. */
const THINGS_TEXT_INSET = HEADER_PAD + GROUP_TILE_INSET;

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: HEADER_PAD, paddingTop: 16, paddingBottom: 12, width: "100%" },
  roomForAction: { paddingRight: 112 },
  caret: { marginTop: 2, flexShrink: 0 },
  action: { position: "absolute", top: 14, right: 16 },
  under: { marginTop: -4, paddingRight: HEADER_PAD, paddingBottom: 12, flexDirection: "row" },
  more: { marginTop: -8, paddingBottom: 10, flexDirection: "row" },
  afterUnder: { marginTop: -6 },
});
