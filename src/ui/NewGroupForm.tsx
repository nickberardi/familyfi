"use client";

import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FAMILY_ROLES, MONOGRAM_MAX, monogramPlaceholder, newGroupCopy, normalizeMonogram, type FamilyRole, type GroupKind } from "@/lib/group-form";
import { createGroup } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";

import { DialogFooter, DialogHeader } from "./DialogParts";
import { FormField } from "./FormField";
import { useUI } from "./UIContext";

/**
 * Adds a family member or a Things group, inside each client's own sheet. Devices are assigned
 * afterwards, so a name (and a role, or a monogram) is all it asks for. `onDone` closes the sheet
 * once the group exists; a failure is reported by the store, and the sheet stays open so nothing
 * typed is lost.
 */
export function NewGroupForm({
  kind,
  mutate,
  enabled = true,
  onDone,
}: {
  kind: GroupKind;
  mutate: HouseholdStore["mutate"];
  /** False while the household is stale, so nothing is sent. */
  enabled?: boolean;
  onDone: () => void;
}) {
  const ui = useUI();
  const [name, setName] = useState("");
  const [familyRole, setFamilyRole] = useState<FamilyRole>("child");
  const [monogram, setMonogram] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = newGroupCopy(kind);
  const canCreate = enabled && !busy && name.trim().length > 0;

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const result = await createGroup(mutate, { kind, name, familyRole, monogram });
    setBusy(false);
    if (result?.group) onDone();
    else setError(copy.failed);
  }

  return (
    <View testID="new-group-form">
      <DialogHeader title={copy.title} body={copy.body} titleId="new-group-title" />
      <View style={styles.fields}>
        <FormField label="Name">
          <ui.TextField label="Name" value={name} onChange={setName} placeholder={copy.namePlaceholder} onSubmit={() => void create()} autoFocus testID="new-group-name" />
        </FormField>
        {kind === "family" ? (
          <FormField label="Role">
            <ui.Segmented name="Role" value={familyRole} onChange={(role) => setFamilyRole(role as FamilyRole)} segments={FAMILY_ROLES} testID="new-group-role" />
          </FormField>
        ) : (
          <FormField label={copy.monogramLabel}>
            <ui.TextField
              label="Monogram"
              value={monogram}
              onChange={(value) => setMonogram(normalizeMonogram(value))}
              placeholder={monogramPlaceholder(name)}
              maxLength={MONOGRAM_MAX}
              onSubmit={() => void create()}
              capitals
              testID="new-group-monogram"
            />
          </FormField>
        )}
        {error ? <Text style={[styles.error, { fontFamily: ui.font, color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
      <DialogFooter
        cancelLabel={copy.cancel}
        onCancel={onDone}
        cancelTestID="new-group-cancel"
        actions={[{ label: copy.create, onPress: () => void create(), disabled: !canCreate, busy, testID: "new-group-create" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  error: { fontSize: 14, lineHeight: 21 },
});
