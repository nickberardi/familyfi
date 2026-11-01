"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { suggestedMonogramFor } from "@/lib/upstream";
import { CATEGORIES_COPY, createCategory } from "@/lib/upstream-writes";

import { FormField } from "./FormField";
import { DialogFooter, DialogHeader } from "./DialogParts";
import { useUI } from "./UIContext";

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
      <DialogHeader title={COPY.title} body={COPY.body} titleId="new-category-title" />
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
      <DialogFooter
        cancelLabel={COPY.cancel}
        onCancel={onDone}
        cancelTestID="new-category-cancel"
        actions={[{ label: COPY.create, onPress: () => void create(), disabled: !canCreate, busy, testID: "new-category-create" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  error: { margin: 0, fontSize: 14, lineHeight: 21 },
});
