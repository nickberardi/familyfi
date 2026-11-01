"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, type ButtonKind } from "./Button";
import { useUI } from "./UIContext";

/**
 * The header and footer a shared dialog's content draws, so the web's dialog and the phone's
 * sheet put the same title, consequence and actions in the same places.
 */
export function DialogHeader({ title, body, titleId }: { title: string; body?: string; titleId?: string }) {
  const ui = useUI();
  return (
    <View style={styles.header}>
      <Text role="heading" aria-level={2} id={titleId} style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
        {title}
      </Text>
      {body ? <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-2") }]}>{body}</Text> : null}
    </View>
  );
}

export type DialogAction = {
  label: string;
  onPress: () => void;
  kind?: Extract<ButtonKind, "primary" | "secondary" | "destructive">;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
};

/**
 * Cancel on the left of the actions, right-aligned, the main action right-most. Three buttons
 * don't fit a 400px dialog or a phone, so with more than one action the footer stacks
 * full-width buttons, the main action on top and Cancel last. `leading` sits on the far left:
 * an Edit sheet's "Delete…".
 */
export function DialogFooter({
  cancelLabel = "Cancel",
  onCancel,
  cancelTestID,
  actions,
  leading,
}: {
  cancelLabel?: string;
  onCancel: () => void;
  cancelTestID?: string;
  /** Main action last. */
  actions: readonly DialogAction[];
  leading?: ReactNode;
}) {
  const cancel = <Button kind="cancel" size="md" label={cancelLabel} onPress={onCancel} testID={cancelTestID} grow={actions.length > 1} />;
  if (actions.length > 1) {
    return (
      <View style={[styles.footer, styles.stacked]}>
        {[...actions].reverse().map((action) => (
          <Button key={action.label} size="md" grow kind={action.kind ?? "primary"} label={action.label} onPress={action.onPress} disabled={action.disabled} busy={action.busy} testID={action.testID} />
        ))}
        {cancel}
      </View>
    );
  }
  return (
    <View style={[styles.footer, styles.row]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      {cancel}
      {actions.map((action) => (
        <Button key={action.label} size="md" kind={action.kind ?? "primary"} label={action.label} onPress={action.onPress} disabled={action.disabled} busy={action.busy} testID={action.testID} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 6, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 20 },
  footer: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 18, gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  leading: { marginRight: "auto" },
});
