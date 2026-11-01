"use client";

import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** One of a card's actions: a button (`onPress`) or a link to a page (`href`). */
export type CardAction = {
  label: string;
  /** The one action to reach for (Resume, Unblock): filled in the accent. Others are outlined. */
  strong?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  href?: string;
  /** Its accessible name, when the label alone does not say what it acts on. */
  accessibilityLabel?: string;
  /** A button that goes to another screen, as a group's Details does, is announced as a link. */
  navigates?: boolean;
  testID?: string;
};

/**
 * A card's foot, the same on the group card and the rule card: its state lines on their own row,
 * then a row of buttons. `leading` (the item's own page: Details, Edit) sits on the left; the
 * other actions sit on the right, the strong one right-most. Every button is outlined except the
 * strong one. At large text sizes the buttons stack, one under another, so no label breaks.
 */
export function CardFoot({ lines = [], leading, actions = [] }: { lines?: readonly string[]; leading?: CardAction; actions?: readonly CardAction[] }) {
  const ui = useUI();
  const stacked = useWindowDimensions().fontScale >= STACK_AT;
  if (!lines.length && !leading && !actions.length) return null;
  const ordered = [...actions.filter((action) => !action.strong), ...actions.filter((action) => action.strong)];
  return (
    <View style={[styles.foot, { borderTopColor: ui.color("line") }]}>
      {lines.length ? (
        <View>
          {lines.map((line) => (
            <Text key={line} style={[styles.line, { fontFamily: ui.font, color: ui.color("ink-2") }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {leading || ordered.length ? (
        <View style={[styles.row, stacked && styles.column]}>
          {leading ? <FootButton action={leading} stacked={stacked} /> : null}
          {!stacked ? <View style={styles.spacer} /> : null}
          {ordered.map((action) => (
            <FootButton key={action.label} action={action} stacked={stacked} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function FootButton({ action, stacked }: { action: CardAction; stacked: boolean }) {
  const ui = useUI();
  const look = [
    styles.button,
    stacked && styles.stretch,
    action.strong ? { backgroundColor: ui.color("accent") } : { borderWidth: 1, borderColor: ui.color("hairline-card"), backgroundColor: ui.color("card") },
    action.disabled && { opacity: action.strong ? 0.6 : 0.4 },
  ];
  const label = <Text style={[styles.label, { fontFamily: ui.font, color: ui.color(action.strong ? "ink-on-fill" : "ink") }]}>{action.label}</Text>;
  if (action.href && !action.disabled) {
    return (
      <ui.Link href={action.href} label={action.accessibilityLabel} testID={action.testID}>
        <View style={look}>{label}</View>
      </ui.Link>
    );
  }
  return (
    <Pressable
      role={action.navigates ? "link" : "button"}
      aria-label={action.accessibilityLabel}
      aria-disabled={action.disabled}
      disabled={action.disabled}
      onPress={action.onPress}
      testID={action.testID}
      style={({ pressed }) => [...look, pressed && !action.disabled && { opacity: PRESS_OPACITY }]}
    >
      {label}
    </Pressable>
  );
}

/** The text size, as a multiple of the default, from which the buttons stack. */
const STACK_AT = 1.35;

const styles = StyleSheet.create({
  foot: { gap: 10, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  line: { fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  column: { flexDirection: "column", alignItems: "stretch" },
  spacer: { flex: 1 },
  button: { minHeight: 36, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7, alignItems: "center", justifyContent: "center" },
  stretch: { alignSelf: "stretch" },
  label: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
});
