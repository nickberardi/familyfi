"use client";

import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** One of a card's actions: a button (`onPress`) or a link to a page (`href`). */
export type CardAction = {
  label: string;
  strong?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  href?: string;
  /** Its accessible name, when the label alone does not say what it acts on. */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * A card's actions in one row across its foot, each an equal share split by hairlines, as the
 * web's group card ends; at large text sizes, one under another so no label breaks. The strong
 * action is the one to reach for.
 */
export function ActionRow({ actions }: { actions: CardAction[] }) {
  const ui = useUI();
  const stacked = useWindowDimensions().fontScale >= STACK_AT;
  if (actions.length === 0) return null;
  const line = ui.color("hairline-strong");
  // Stacked, a cell takes its own height: `flex: 1` in a column of no set height takes none.
  const cell = stacked ? styles.stackedCell : styles.cell;
  return (
    <View style={[styles.row, stacked && styles.column, { borderTopColor: line }]}>
      {actions.map((action, index) => {
        const label = (
          <Text
            style={{
              fontFamily: ui.font,
              fontSize: 15,
              lineHeight: 22,
              fontWeight: action.strong ? "600" : "500",
              textAlign: "center",
              color: ui.color(action.disabled ? "disabled" : "accent"),
            }}
          >
            {action.label}
          </Text>
        );
        const divider = !index
          ? null
          : stacked
            ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line }
            : { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: line };
        if (action.href && !action.disabled) {
          return (
            <View key={action.label} style={[cell, divider]}>
              <ui.Link href={action.href} label={action.accessibilityLabel} testID={action.testID}>
                <View style={styles.hit}>{label}</View>
              </ui.Link>
            </View>
          );
        }
        return (
          <Pressable
            key={action.label}
            role="button"
            aria-label={action.accessibilityLabel}
            aria-disabled={action.disabled}
            disabled={action.disabled}
            onPress={action.onPress}
            testID={action.testID}
            style={({ pressed }) => [cell, styles.hit, divider, pressed && { opacity: PRESS_OPACITY }]}
          >
            {label}
          </Pressable>
        );
      })}
    </View>
  );
}

/** The text size, as a multiple of the default, from which the actions stack. */
const STACK_AT = 1.35;

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  column: { flexDirection: "column" },
  cell: { flex: 1, minWidth: 0, justifyContent: "center" },
  stackedCell: { justifyContent: "center" },
  hit: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, paddingVertical: 10 },
});
