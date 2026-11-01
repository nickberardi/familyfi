"use client";

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { addAppCopy, createAppRule } from "@/lib/filter-sheet";
import type { HouseholdStore } from "@/lib/household-store";
import { searchCatalog, type CatalogItem } from "@/lib/rule-catalog";
import type { Group } from "@/lib/types";

import { FieldLabel } from "./FieldLabel";
import { DialogFooter, DialogHeader } from "./DialogParts";
import { useUI } from "./UIContext";

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
  /** After the rule is saved; the store reloads on its own once the change lands. */
  onCreated?: () => void;
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

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const id = Number(appId);
    const result = await createAppRule(mutate, group, catalog.find((item) => item.id === id), id, mode);
    setBusy(false);
    // A write the server refused leaves the form open, saying so.
    if (result === undefined) {
      setError(copy.createFailed);
      return;
    }
    onCreated?.();
    onDone();
  }

  return (
    <View testID="add-app-form">
      <DialogHeader title={copy.title} body={copy.body} titleId="add-app-title" />
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
      <DialogFooter
        cancelLabel={copy.cancel}
        onCancel={onDone}
        cancelTestID="add-app-cancel"
        actions={[{ label: copy.create, onPress: () => void create(), disabled: !canCreate, busy, testID: "add-app-create" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 14, paddingHorizontal: 18, paddingVertical: 14 },
  search: { marginBottom: 8 },
  error: { margin: 0, fontSize: 14, lineHeight: 21 },
});
