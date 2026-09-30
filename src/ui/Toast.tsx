"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { useUI } from "./UIContext";

/**
 * The outcome of the last write, shared by every client: the notice (in the "on" colour) or the
 * error (in danger), a notice's action such as Undo, and Dismiss. Where it sits on screen, and how
 * it is announced, belongs to the caller.
 */
export function Toast({
  error,
  notice,
  actionLabel,
  onAction,
  onDismiss,
}: {
  error: string;
  notice: string;
  /** A notice's action, such as "Undo"; never shown beside an error. */
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  const ui = useUI();
  const message = error || notice;
  if (!message) return null;
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  return (
    <View
      role={error ? "alert" : "status"}
      testID="toast"
      style={[styles.toast, { backgroundColor: ui.color("card"), borderColor: ui.color("line"), boxShadow: ui.shadow("toast") }]}
    >
      <Text testID="toast-message" style={[text, styles.message, { color: ui.color(error ? "danger" : "on") }]}>
        {message}
      </Text>
      {!error && actionLabel && onAction ? (
        <Pressable role="button" testID="toast-action" hitSlop={TOUCH} onPress={onAction} style={styles.button}>
          <Text style={[text, { fontWeight: "600", color: ui.color("accent") }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable role="button" aria-label="Dismiss" testID="toast-dismiss" hitSlop={TOUCH} onPress={onDismiss} style={styles.button}>
        {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
          <Text style={[text, { fontWeight: "600", color: ui.color(hovered ? "ink" : "muted") }]}>Dismiss</Text>
        )}
      </Pressable>
    </View>
  );
}

/** Reaches 44 pt to touch on a phone; react-native-web ignores it, so the web is unchanged. */
const TOUCH = { top: 12, bottom: 12, left: 8, right: 8 };

const styles = StyleSheet.create({
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    maxWidth: 512,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  message: { flex: 1, minWidth: 0 },
  button: { flexShrink: 0, borderRadius: 4, paddingHorizontal: 6 },
});
