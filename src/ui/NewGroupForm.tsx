"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FAMILY_ROLES, MONOGRAM_MAX, monogramPlaceholder, newGroupCopy, normalizeMonogram, type FamilyRole, type GroupKind } from "@/lib/group-form";
import { createGroup } from "@/lib/group-writes";
import type { HouseholdStore } from "@/lib/household-store";

import { FieldLabel } from "./FieldLabel";
import { PRESS_OPACITY, useUI } from "./UIContext";

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
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };

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
      <View style={styles.header}>
        <Text role="heading" aria-level={2} id="new-group-title" style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {copy.title}
        </Text>
        <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{copy.body}</Text>
      </View>
      <View style={styles.fields}>
        <View>
          <FieldLabel>Name</FieldLabel>
          <ui.TextField label="Name" value={name} onChange={setName} placeholder={copy.namePlaceholder} onSubmit={() => void create()} autoFocus testID="new-group-name" />
        </View>
        {kind === "family" ? (
          <View>
            <FieldLabel>Role</FieldLabel>
            <ui.Segmented name="Role" value={familyRole} onChange={(role) => setFamilyRole(role as FamilyRole)} segments={FAMILY_ROLES} testID="new-group-role" />
          </View>
        ) : (
          <View>
            <FieldLabel>{copy.monogramLabel}</FieldLabel>
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
          </View>
        )}
        {error ? <Text style={[styles.error, { fontFamily: ui.font, color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
      <View style={[styles.footer, { borderTopColor: ui.color("hairline-card") }]}>
        <Pressable role="button" onPress={onDone} testID="new-group-cancel" style={({ pressed }) => [styles.footerButton, pressed && { opacity: PRESS_OPACITY }]}>
          <Text style={[text, { color: ui.color("ink-3") }]}>{copy.cancel}</Text>
        </Pressable>
        <Pressable
          role="button"
          aria-disabled={!canCreate}
          disabled={!canCreate}
          onPress={() => void create()}
          testID="new-group-create"
          style={({ pressed }) => [styles.footerButton, { borderLeftWidth: 1, borderLeftColor: ui.color("hairline-card") }, pressed && canCreate && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[text, styles.strong, { color: ui.color(canCreate ? "accent" : "locked") }]}>{copy.create}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  title: { fontSize: 17, lineHeight: 25.5, fontWeight: "700", letterSpacing: -0.425 },
  body: { marginTop: 4, fontSize: 13, lineHeight: 17.875 },
  fields: { gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  error: { fontSize: 13, lineHeight: 19.5 },
  footer: { flexDirection: "row", borderTopWidth: 1 },
  footerButton: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingVertical: 13 },
  strong: { fontWeight: "600" },
});
