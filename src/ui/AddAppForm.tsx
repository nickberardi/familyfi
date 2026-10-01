"use client";

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { addAppCopy, createAppRule } from "@/lib/filter-sheet";
import type { HouseholdStore } from "@/lib/household-store";
import { searchCatalog, type CatalogItem } from "@/lib/rule-catalog";
import type { Group } from "@/lib/types";

import { FieldLabel } from "./FieldLabel";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * Blocks an app for one group, from the gateway's app catalog: always, or overnight every day. Only
 * app rules get this; categories are a fixed catalog with nothing to add.
 */
export function AddAppForm({
  group,
  request,
  mutate,
  enabled = true,
  onCreated,
  onDone,
}: {
  group: Pick<Group, "id" | "name">;
  request: ApiRequest;
  mutate: HouseholdStore["mutate"];
  /** False while the household is stale, so nothing is sent. */
  enabled?: boolean;
  onCreated: () => void;
  onDone: () => void;
}) {
  const ui = useUI();
  const copy = addAppCopy(group);
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [appId, setAppId] = useState("");
  const [mode, setMode] = useState<"always" | "scheduled">("always");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void searchCatalog(request, "app", filter)
      .then((items) => {
        if (cancelled) return;
        setCatalog(items);
        setError("");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setCatalog([]);
        setError(err.message || copy.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, request, copy.loadFailed]);

  const canCreate = enabled && appId !== "" && !busy;
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const id = Number(appId);
    await createAppRule(mutate, group, catalog.find((item) => item.id === id), id, mode);
    setBusy(false);
    onCreated();
    onDone();
  }

  return (
    <View testID="add-app-form">
      <View style={styles.header}>
        <Text role="heading" aria-level={2} id="add-app-title" style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {copy.title}
        </Text>
        <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{copy.body}</Text>
      </View>
      <View style={styles.fields}>
        <View>
          <FieldLabel>{copy.app}</FieldLabel>
          <View style={styles.search}>
            <ui.TextField label={copy.search} value={filter} onChange={setFilter} placeholder={copy.search} search disabled={!enabled} testID="add-app-search" />
          </View>
          <ui.Select
            label={copy.picker}
            value={appId}
            options={catalog.map((item) => ({ value: String(item.id), label: item.name }))}
            onChange={setAppId}
            placeholder={copy.pick}
            disabled={!enabled}
            variant="field"
            testID="add-app-picker"
          />
        </View>
        <View>
          <FieldLabel>{copy.enforcement}</FieldLabel>
          <ui.Segmented
            name={copy.enforcement}
            value={mode}
            onChange={(next) => setMode(next as "always" | "scheduled")}
            segments={[
              { value: "always", label: copy.always },
              { value: "scheduled", label: copy.scheduled },
            ]}
            disabled={!enabled}
            testID="add-app-mode"
          />
        </View>
        {error ? <Text style={[styles.error, { fontFamily: ui.font, color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
      <View style={[styles.footer, { borderTopColor: ui.color("hairline-card") }]}>
        <Pressable role="button" onPress={onDone} testID="add-app-cancel" style={({ pressed }) => [styles.footerButton, pressed && { opacity: PRESS_OPACITY }]}>
          <Text style={[text, { color: ui.color("ink-3") }]}>{copy.cancel}</Text>
        </Pressable>
        <Pressable
          role="button"
          aria-disabled={!canCreate}
          disabled={!canCreate}
          onPress={() => void create()}
          testID="add-app-create"
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
  title: { margin: 0, fontSize: 17, lineHeight: 25.5, fontWeight: "700", letterSpacing: -0.425 },
  body: { marginTop: 4, fontSize: 13, lineHeight: 17.875 },
  fields: { gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  search: { marginBottom: 8 },
  error: { fontSize: 13, lineHeight: 19.5 },
  footer: { flexDirection: "row", borderTopWidth: 1 },
  footerButton: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingVertical: 13 },
  strong: { fontWeight: "600" },
});
