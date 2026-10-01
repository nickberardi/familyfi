"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { filterSheetCopy } from "@/lib/filter-sheet";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * What a category's or app rule's sheet says and offers (`src/lib/filter-sheet.ts`), shared by
 * every client inside its own sheet. Links to the rule editor and the measured results are each
 * client's own, so they come in as slots.
 */
export function FilterSheetContent({
  copy,
  busy,
  disabled = false,
  error,
  note,
  details,
  editLink,
  websitesAction,
  onAction,
  onCancel,
}: {
  copy: ReturnType<typeof filterSheetCopy>;
  busy: boolean;
  /** True while the household is stale, so nothing is sent. */
  disabled?: boolean;
  error: string;
  /** A line under the words, such as why the button is disabled. */
  note?: string;
  /** The measured results by network. */
  details?: ReactNode;
  /** "Edit rule and schedule" or "Schedule it instead". */
  editLink?: ReactNode;
  /** "Block its websites", for a category UniFi cannot block. */
  websitesAction?: ReactNode;
  onAction: () => void;
  onCancel: () => void;
}) {
  const ui = useUI();
  const text = (size: number, lineHeight: number) => ({ fontFamily: ui.font, fontSize: size, lineHeight });
  const turnOff = copy.action === "turnOff";
  const off = busy || disabled;
  return (
    <View testID="filter-sheet">
      <View style={styles.content}>
        <Text role="heading" aria-level={2} id="filter-sheet-title" style={[text(16, 24), styles.heading, { color: ui.color("ink") }]}>
          {copy.heading}
        </Text>
        <Text style={[text(13, 17.875), { color: ui.color("ink-3") }]}>{copy.body}</Text>
        {copy.windows.length ? (
          <View role="list">
            {copy.windows.map((line) => (
              <Text key={line} role="listitem" style={[text(13, 17.875), { color: ui.color("ink-2") }]}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {details}
        {note ? <Text style={[text(13, 19.5), { color: ui.color("muted") }]}>{note}</Text> : null}
        {error ? <Text style={[text(13, 19.5), { color: ui.color("danger") }]}>{error}</Text> : null}
        {copy.action === "websites" ? (
          websitesAction
        ) : (
          <>
            <Pressable
              role="button"
              aria-disabled={off}
              disabled={off}
              onPress={onAction}
              testID="filter-sheet-action"
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: ui.color(turnOff ? "danger-fill" : "accent") },
                off && { opacity: 0.5 },
                pressed && !off && { opacity: PRESS_OPACITY },
              ]}
            >
              <Text style={[text(14, 21), styles.strong, { color: ui.color(turnOff ? "danger" : "ink-on-fill") }]}>{copy.actionLabel}</Text>
            </Pressable>
            {editLink}
          </>
        )}
      </View>
      <Pressable
        role="button"
        onPress={onCancel}
        testID="filter-sheet-cancel"
        style={({ pressed }) => [styles.cancel, { borderTopColor: ui.color("hairline-card") }, pressed && { opacity: PRESS_OPACITY }]}
      >
        <Text style={[text(14, 21), { color: ui.color("ink-3") }]}>{copy.cancel}</Text>
      </Pressable>
    </View>
  );
}

/** The style a client's own link under the button takes, to sit with the shared sheet. */
export const FILTER_SHEET_LINK = { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" } as const;

const styles = StyleSheet.create({
  content: { gap: 10, padding: 20 },
  heading: { fontWeight: "700", letterSpacing: -0.4 },
  strong: { fontWeight: "600", textAlign: "center" },
  action: { marginTop: 4, borderRadius: 9, paddingVertical: 10, alignItems: "center" },
  cancel: { borderTopWidth: 1, paddingVertical: 12, alignItems: "center" },
});
