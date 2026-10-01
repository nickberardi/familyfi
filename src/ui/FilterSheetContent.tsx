"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { filterSheetCopy } from "@/lib/filter-sheet";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * What a category's or app rule's sheet says and offers (`src/lib/filter-sheet.ts`), shared by
 * every client inside its own sheet. Its links go through the platform's `Link`; the measured
 * results come in as a slot.
 */
export function FilterSheetContent({
  copy,
  busy,
  disabled = false,
  error,
  note,
  details,
  editHref,
  websitesHref,
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
  /** Where "Edit rule and schedule" or "Schedule it instead" goes (`filterEditHref`). */
  editHref?: string;
  /** Where "Block its websites" goes (`filterWebsitesHref`), for a category UniFi cannot block. */
  websitesHref?: string;
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
            {/* A rule's windows in order; two can read the same, so the position is the key. */}
            {copy.windows.map((line, index) => (
              <Text key={index} role="listitem" style={[text(13, 17.875), { color: ui.color("ink-2") }]}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {details}
        {note ? <Text style={[text(13, 19.5), { color: ui.color("muted") }]}>{note}</Text> : null}
        {error ? <Text style={[text(13, 19.5), { color: ui.color("danger") }]}>{error}</Text> : null}
        {copy.action === "websites" ? (
          websitesHref ? (
            <ui.Link href={websitesHref} onNavigate={onCancel} testID="filter-sheet-websites">
              <View style={[styles.action, { backgroundColor: ui.color("accent") }]}>
                <Text style={[text(14, 21), styles.strong, { color: ui.color("ink-on-fill") }]}>{copy.actionLabel}</Text>
              </View>
            </ui.Link>
          ) : null
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
            {editHref ? (
              <ui.Link href={editHref} onNavigate={onCancel} testID="filter-sheet-edit">
                <Text style={[text(14, 21), styles.strong, { color: ui.color("accent") }]}>{copy.editLabel}</Text>
              </ui.Link>
            ) : null}
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


const styles = StyleSheet.create({
  content: { gap: 10, padding: 20 },
  heading: { fontWeight: "700", letterSpacing: -0.4 },
  strong: { fontWeight: "600", textAlign: "center" },
  action: { marginTop: 4, borderRadius: 9, paddingVertical: 10, alignItems: "center" },
  cancel: { borderTopWidth: 1, paddingVertical: 12, alignItems: "center" },
});
