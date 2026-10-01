"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { suggestedMonogramFor } from "@/lib/upstream";
import { CATEGORIES_COPY, createCategory } from "@/lib/upstream-writes";

import { FormField } from "./FormField";
import { PRESS_OPACITY, useUI } from "./UIContext";

const COPY = CATEGORIES_COPY.create;

/**
 * A custom category: report-only by construction, since there is no DPI id to give it. The monogram
 * is typed rather than picked from icons, because a household can invent a category with no artwork.
 */
export function NewCategoryForm({
  request,
  enabled = true,
  onCreated,
  onDone,
}: {
  request: ApiRequest;
  /** False while the household is stale, so nothing is sent. */
  enabled?: boolean;
  onCreated: () => void;
  onDone: () => void;
}) {
  const ui = useUI();
  const [label, setLabel] = useState("");
  const [monogram, setMonogram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = label.trim();
  const canCreate = enabled && !busy && trimmed.length > 0;
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    try {
      await createCategory(request, trimmed, monogram);
      onCreated();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : COPY.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID="new-category-form">
      <View style={styles.header}>
        <Text role="heading" aria-level={2} id="new-category-title" style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {COPY.title}
        </Text>
        <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{COPY.body}</Text>
      </View>
      <View style={styles.fields}>
        <FormField label={COPY.name}>
          <ui.TextField label={COPY.nameLabel} value={label} onChange={setLabel} placeholder={COPY.namePlaceholder} onSubmit={() => void create()} autoFocus testID="new-category-name" />
        </FormField>
        <FormField label={COPY.monogram}>
          <ui.TextField
            label={COPY.monogramLabel}
            value={monogram}
            onChange={(value) => setMonogram(value.toUpperCase())}
            placeholder={trimmed ? suggestedMonogramFor(trimmed) : COPY.monogramPlaceholder}
            maxLength={4}
            onSubmit={() => void create()}
            capitals
            testID="new-category-monogram"
          />
        </FormField>
        {error ? <Text style={[styles.error, { fontFamily: ui.font, color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
      <View style={[styles.footer, { borderTopColor: ui.color("hairline-card") }]}>
        <Pressable role="button" onPress={onDone} testID="new-category-cancel" style={({ pressed }) => [styles.footerButton, pressed && { opacity: PRESS_OPACITY }]}>
          <Text style={[text, { color: ui.color("ink-3") }]}>{COPY.cancel}</Text>
        </Pressable>
        <Pressable
          role="button"
          aria-disabled={!canCreate}
          disabled={!canCreate}
          onPress={() => void create()}
          testID="new-category-create"
          style={({ pressed }) => [styles.footerButton, { borderLeftWidth: 1, borderLeftColor: ui.color("hairline-card") }, pressed && canCreate && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[text, styles.strong, { color: ui.color(canCreate ? "accent" : "locked") }]}>{COPY.create}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  title: { margin: 0, fontSize: 17, lineHeight: 25.5, fontWeight: "700", letterSpacing: -0.425 },
  body: { marginTop: 4, fontSize: 13, lineHeight: 17.875 },
  fields: { gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  error: { margin: 0, fontSize: 13, lineHeight: 19.5 },
  footer: { flexDirection: "row", borderTopWidth: 1 },
  footerButton: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingVertical: 13 },
  strong: { fontWeight: "600" },
});
