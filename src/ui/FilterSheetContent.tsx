"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { filterSheetCopy } from "@/lib/filter-sheet";

import { Button } from "./Button";
import { DialogHeader } from "./DialogParts";
import { useUI } from "./UIContext";

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
  /** Where "Edit rule and schedule" or "Block on a schedule…" goes (`filterEditHref`). */
  editHref?: string;
  /** Where "Block its websites" goes (`filterWebsitesHref`), for a category UniFi cannot block. */
  websitesHref?: string;
  onAction: () => void;
  onCancel: () => void;
}) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 20 };
  const turnOff = copy.action === "turnOff";
  const off = busy || disabled;
  /** A link drawn as a button of the given role: the web's Link or the platform's route. */
  const linkButton = (href: string, label: string, role: "primary" | "secondary", testID: string) => (
    <ui.Link href={href} onNavigate={onCancel} testID={testID}>
      <View style={[styles.linkButton, role === "primary" ? { backgroundColor: ui.color("accent") } : { borderWidth: 1, borderColor: ui.color("accent-line"), backgroundColor: ui.color("accent-fill") }]}>
        <Text style={[text, styles.strong, { color: ui.color(role === "primary" ? "ink-on-fill" : "accent-hover") }]}>{label}</Text>
      </View>
    </ui.Link>
  );
  return (
    <View testID="filter-sheet">
      <DialogHeader title={copy.heading} body={copy.body} titleId="filter-sheet-title" />
      <View style={styles.content}>
        {copy.windows.length ? (
          <View role="list">
            {/* A rule's windows in order; two can read the same, so the position is the key. */}
            {copy.windows.map((line, index) => (
              <Text key={index} role="listitem" style={[text, { color: ui.color("ink-2") }]}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}
        {details}
        {note ? <Text style={[text, { color: ui.color("ink-2") }]}>{note}</Text> : null}
        {error ? <Text style={[text, { color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
      {/* Main action on top, the other way to go next, then Cancel: three don't fit a row. */}
      <View style={styles.footer}>
        {copy.action === "websites" ? (
          websitesHref ? linkButton(websitesHref, copy.actionLabel, "primary", "filter-sheet-websites") : null
        ) : (
          <>
            <Button size="md" grow kind={turnOff ? "destructive" : "primary"} label={copy.actionLabel} onPress={onAction} disabled={off} testID="filter-sheet-action" />
            {editHref && copy.editLabel ? linkButton(editHref, copy.editLabel, "secondary", "filter-sheet-edit") : null}
          </>
        )}
        <Button size="md" grow kind="cancel" label={copy.cancel} onPress={onCancel} testID="filter-sheet-cancel" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 10, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 10 },
  strong: { fontWeight: "600", textAlign: "center" },
  linkButton: { borderRadius: 9, paddingVertical: 7, paddingHorizontal: 14, minHeight: 36, alignItems: "center", justifyContent: "center" },
  footer: { gap: 8, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 18 },
});
