"use client";

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import {
  CATALOG_RESULTS_SHOWN,
  catalogCopy,
  catalogFamiliar,
  catalogMatches,
  searchCatalog,
  type CatalogItem,
  type CatalogKind,
} from "@/lib/rule-catalog";
import { CURATED_CATEGORY_SLOTS, catalogLabel } from "@/lib/rules";

import { CategoryGlyph } from "./CategoryGlyph";
import { Chip, ChipGroup } from "./Chips";
import { useUI } from "./UIContext";

/**
 * The categories or apps a rule blocks, picked the way websites are: the box holds only what is
 * picked, and a search asks the gateway's catalog for matches to add. Nothing is listed by hand, so
 * whatever the gateway supports can be found.
 */
export function CatalogPicker({
  kind,
  targetIds,
  onChange,
  request,
  disabled = false,
}: {
  kind: CatalogKind;
  targetIds: number[];
  onChange: (ids: number[]) => void;
  request: ApiRequest;
  disabled?: boolean;
}) {
  const ui = useUI();
  const copy = catalogCopy(kind);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; items: CatalogItem[] }>({ query: "", items: [] });
  const [names, setNames] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState("");
  const remember = (items: CatalogItem[]) => setNames((current) => new Map([...current, ...items.map((item) => [item.id, item.name] as const)]));

  // A saved rule's picks need their names once.
  const [initial] = useState(targetIds);
  useEffect(() => {
    if (initial.length === 0) return;
    let cancelled = false;
    void searchCatalog(request, kind, "")
      .then((items) => {
        if (!cancelled) remember(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only the rule as it was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Search as you type, and drop answers to a query that has since changed.
  useEffect(() => {
    const filter = query.trim();
    if (!filter) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void searchCatalog(request, kind, filter)
        .then((items) => {
          if (cancelled) return;
          remember(items);
          setResults({ query: filter, items: items.slice(0, CATALOG_RESULTS_SHOWN) });
          setError("");
        })
        .catch(() => {
          if (!cancelled) setError(copy.failed);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const filter = query.trim();
  const found = filter && results.query === filter ? results.items : [];
  const matches = catalogMatches(kind, filter, found, targetIds);
  const label = (id: number) => catalogLabel(kind, id, names);
  const slot = (id: number) => (kind === "category" ? CURATED_CATEGORY_SLOTS.find((item) => item.categoryId === id) : undefined);
  const add = (id: number) => {
    onChange([...targetIds, id]);
    setQuery("");
  };
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  return (
    <View style={styles.picker}>
      <View style={[styles.box, { borderColor: ui.color("input-line"), backgroundColor: ui.color("card") }]}>
        {targetIds.map((id) => {
          const known = slot(id);
          return (
            <View key={id} style={[styles.picked, { backgroundColor: ui.color("field") }]} testID={`catalog-picked-${id}`}>
              {known ? <CategoryGlyph slot={known.slot} size={12} color={ui.color("ink")} /> : null}
              <Text style={[text, { color: ui.color("ink") }]}>{label(id)}</Text>
              <Pressable
                role="button"
                aria-label={`Remove ${label(id)}`}
                aria-disabled={disabled}
                disabled={disabled}
                onPress={() => onChange(targetIds.filter((item) => item !== id))}
              >
                <Text style={[text, { color: ui.color("danger") }]}>×</Text>
              </Pressable>
            </View>
          );
        })}
        <View style={styles.search}>
          <ui.TextField
            label={copy.search}
            value={query}
            onChange={setQuery}
            onSubmit={() => {
              if (matches[0]) add(matches[0].id);
            }}
            placeholder={copy.placeholder}
            disabled={disabled}
            testID={`catalog-search-${kind}`}
          />
        </View>
      </View>
      {matches.length ? (
        <ChipGroup label={copy.matches}>
          {matches.map((item) => {
            const known = slot(item.id);
            return (
              <Chip key={item.id} on={false} tone="rule" onPress={() => add(item.id)} disabled={disabled} testID={`catalog-match-${item.id}`}>
                {known ? <CategoryGlyph slot={known.slot} size={13} color={ui.color("ink-2")} /> : null}
                <Text style={[text, styles.chipLabel, { color: ui.color("ink-2") }]}>{label(item.id)}</Text>
              </Chip>
            );
          })}
        </ChipGroup>
      ) : filter && results.query === filter && !error && !catalogFamiliar(kind, filter).length ? (
        <Text style={[text, { color: ui.color("ink-2") }]}>{copy.none(filter)}</Text>
      ) : null}
      {error ? <Text style={[text, { color: ui.color("danger") }]}>{error}</Text> : null}
      <Text style={[text, styles.note, { color: ui.color("ink-2") }]}>{copy.note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 8 },
  box: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, borderRadius: 9, borderWidth: 1, padding: 8 },
  picked: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  search: { minWidth: 180, flex: 1 },
  chipLabel: { fontWeight: "600" },
  note: { lineHeight: 20 },
});
