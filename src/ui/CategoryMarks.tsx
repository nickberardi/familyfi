/**
 * The marks a card and a group detail carry below the internet zone: a 34px circle per category or
 * app rule, with its label and its state word beneath, per the Card System. Each mark opens its own
 * sheet; Pause, Resume and Allow stay with all internet alone, in the zone above, so a category
 * control never reads as a device-wide one.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CategorySlotState } from "@/lib/category-marks";
import { moreMarkLabels } from "@/lib/category-marks";
import { categoryMarkLabel, categoryMarkStyle, categoryMarkWord, type CategoryMarkState } from "@/lib/upstream";

import { CategoryGlyph } from "./CategoryGlyph";
import { tokenOf, useUI } from "./UIContext";

/** A small section heading between rows of marks. */
export function SectionLabel({ children }: { children: string }) {
  const ui = useUI();
  return (
    <Text style={{ fontFamily: ui.font, fontSize: 11, lineHeight: 16, fontWeight: "600", letterSpacing: 0.55, textTransform: "uppercase", color: ui.color("ink-2") }}>
      {children}
    </Text>
  );
}

/** The colours a mark state paints, from the shared display logic's CSS variables. */
export function useMarkColors(state: CategoryMarkState) {
  const ui = useUI();
  const { fill, ink } = categoryMarkStyle(state);
  return { fill: ui.color(tokenOf(fill)), ink: ui.color(tokenOf(ink)) };
}

/** A 34px mark with its label and state word beneath. */
export function MarkButton({
  label,
  state,
  onPress,
  testID,
  children,
}: {
  label: string;
  state: CategoryMarkState;
  onPress: () => void;
  testID?: string;
  /** The glyph, drawn in `useMarkColors(state).ink`. */
  children: ReactNode;
}) {
  const ui = useUI();
  const { fill } = useMarkColors(state);
  const word = categoryMarkWord(state);
  const small = { fontFamily: ui.font, color: ui.color("ink-2"), textAlign: "center" as const };
  return (
    <Pressable role="button" aria-label={categoryMarkLabel(label, state)} onPress={onPress} testID={testID} style={styles.mark}>
      <View style={[styles.circle, { backgroundColor: fill }]}>{children}</View>
      <Text style={[small, styles.label]} numberOfLines={1}>
        {label}
      </Text>
      {/* Always rendered, even when wordless, so marks in a row keep one baseline. */}
      <Text style={[small, styles.word]}>{word || " "}</Text>
    </Pressable>
  );
}

/** A category's glyph: its DPI slot's mark, its seeded icon, or its monogram. */
export function CategoryMarkGlyph({ item, size, color }: { item: CategorySlotState; size: number; color: string }) {
  const ui = useUI();
  if (item.slot) return <CategoryGlyph slot={item.slot.slot} size={size} color={color} />;
  if (item.icon) return <ui.Icon name={item.icon} size={size} color={color} />;
  return <Text style={{ fontFamily: ui.font, fontSize: 9, lineHeight: 12, fontWeight: "700", color }}>{item.monogram}</Text>;
}

/** A category's mark, with its glyph in the state's ink. */
export function CategoryMark({ item, onPress, testID }: { item: CategorySlotState; onPress: () => void; testID?: string }) {
  const { ink } = useMarkColors(item.state);
  return (
    <MarkButton label={item.label} state={item.state} onPress={onPress} testID={testID}>
      <CategoryMarkGlyph item={item} size={15} color={ink} />
    </MarkButton>
  );
}

/** An app rule's mark: its short monogram. */
export function AppMark({ label, glyph, state, onPress }: { label: string; glyph: string; state: CategoryMarkState; onPress: () => void }) {
  const ui = useUI();
  const { ink } = useMarkColors(state);
  return (
    <MarkButton label={label} state={state} onPress={onPress}>
      <Text style={{ fontFamily: ui.font, fontSize: 9, lineHeight: 12, fontWeight: "700", color: ink }}>{glyph}</Text>
    </MarkButton>
  );
}

/** "More" (or "Fewer") at the end of a row of marks. */
export function MoreMark({ more, total, hidden, onPress }: { more: boolean; total: number; hidden: number; onPress: () => void }) {
  const ui = useUI();
  const words = moreMarkLabels(more, total, hidden);
  const accent = ui.color("accent");
  return (
    <Pressable role="button" aria-label={words.accessibilityLabel} onPress={onPress} style={styles.mark}>
      <View style={[styles.circle, styles.dashed, { borderColor: ui.color("control-line") }]}>
        <Text style={{ fontFamily: ui.font, fontSize: 10, lineHeight: 14, fontWeight: "700", color: accent }}>{words.badge}</Text>
      </View>
      <Text style={{ fontFamily: ui.font, fontSize: 10, lineHeight: 15, color: accent }}>{words.word}</Text>
      <Text style={styles.word}> </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: { width: 52, alignItems: "center", gap: 4 },
  circle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dashed: { borderWidth: 1, borderStyle: "dashed" },
  label: { fontSize: 10, lineHeight: 15 },
  word: { fontSize: 9, lineHeight: 13.5 },
});
