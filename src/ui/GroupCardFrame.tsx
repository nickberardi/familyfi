"use client";

import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { InternetWindow } from "@/lib/rule-windows";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { CardButton, CardMenuButton, CardTextButton, type ZoneAction } from "./CardActions";
import { GROUP_TILE_INSET, GroupCardHeader } from "./GroupCardHeader";
import { useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";
import { useWide } from "./use-wide";

/**
 * A group card's frame, shared by every client: the card, and its header as the button that opens
 * and closes it. Closed, the header shows a caret. Open, the group's one button (`action`: Block,
 * Unblock or Resume) takes the caret's corner, with More time under the status line while a timed
 * block or unblock lasts (`more`), and a dropdown beside it while a rule can be paused from the card
 * (`menu`); the caller then offers its own way to close. At large text sizes
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
  menu = [],
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
  /** Pauses for the group's rules, in a dropdown beside `action`. */
  menu?: ZoneAction[];
  testID?: string;
  children?: ReactNode;
}) {
  const ui = useUI();
  const [menuOpen, setMenuOpen] = useState(false);
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
        // An open dropdown hangs past the card's edge, over the cards below.
        corner || under ? menuOpen && menu.length > 0 && styles.raised : null,
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
        style={[styles.header, corner ? (menu.length ? styles.roomForMenu : styles.roomForAction) : null]}
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
          <HeaderButton action={action} menu={menu} name={group.name} align="right" onMenu={setMenuOpen} />
        </View>
      ) : null}
      {under ? (
        <View style={[styles.under, { paddingLeft: inset }]}>
          <HeaderButton action={action} menu={menu} name={group.name} align="left" onMenu={setMenuOpen} />
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

/** The group's one button, with its dropdown when there are rules to pause. */
function HeaderButton({
  action,
  menu,
  name,
  align,
  onMenu,
}: {
  action: ZoneAction;
  menu: ZoneAction[];
  name: string;
  align: "left" | "right";
  onMenu: (open: boolean) => void;
}) {
  if (menu.length === 0) return <CardButton action={{ ...action, strong: true }} />;
  return <CardMenuButton action={action} menu={menu} menuLabel={`Pause a rule for ${name}`} align={align} onOpenChange={onMenu} />;
}

const HEADER_PAD = 18;
/** Where a things card's words start: past its monogram tile. */
const THINGS_TEXT_INSET = HEADER_PAD + GROUP_TILE_INSET;

const styles = StyleSheet.create({
  card: { borderRadius: 12, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: HEADER_PAD, paddingTop: 16, paddingBottom: 12, width: "100%" },
  roomForAction: { paddingRight: 112 },
  roomForMenu: { paddingRight: 132 },
  raised: { overflow: "visible", zIndex: 5 },
  caret: { marginTop: 2, flexShrink: 0 },
  action: { position: "absolute", top: 14, right: 16, zIndex: 10 },
  under: { marginTop: -4, paddingRight: HEADER_PAD, paddingBottom: 12, flexDirection: "row" },
  more: { marginTop: -8, paddingBottom: 10, flexDirection: "row" },
  afterUnder: { marginTop: -6 },
});
