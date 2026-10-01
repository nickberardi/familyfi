"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { effectiveCheck, verdictDetailText, verdictStyle, type UpstreamCategoryRow } from "@/lib/upstream";
import { upstreamCategoryIcon } from "@/lib/upstream-domains";
import { CATEGORIES_COPY as COPY } from "@/lib/upstream-writes";

import { MonoTile } from "./MonoTile";
import { PRESS_OPACITY, useUI } from "./UIContext";
import { useWide } from "./use-wide";
import { VerdictChip } from "./VerdictChip";

/** The household's stance on these lists, stated where it is acted on. */
export function CategoriesStance() {
  const ui = useUI();
  return <Text style={[styles.stance, { fontFamily: ui.font, color: ui.color("ink-3") }]}>{COPY.stance}</Text>;
}

/**
 * Every category with its latest verdict and whether it is checked. The switch only turns checking
 * on or off; it never blocks or unblocks anything, and reads On or Off beside a verdict that can
 * itself read "Not checked", so the two never blur.
 */
export function CategoriesList({
  categories,
  busy,
  onCheckAll,
  onToggle,
}: {
  categories: UpstreamCategoryRow[];
  /** True while a change is in flight, or the household is stale. */
  busy: boolean;
  onCheckAll: () => void;
  onToggle: (category: UpstreamCategoryRow) => void;
}) {
  const ui = useUI();
  const wide = useWide();
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="categories-list">
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text style={[styles.count, { fontFamily: ui.font, color: ui.color("ink") }]}>{COPY.count(categories.length)}</Text>
        <Pressable
          role="button"
          aria-disabled={busy}
          disabled={busy}
          onPress={onCheckAll}
          testID="categories-check-all"
          style={({ pressed }) => [styles.checkAll, { borderColor: ui.color("control-line") }, busy && { opacity: 0.4 }, pressed && !busy && { opacity: PRESS_OPACITY }]}
        >
          <Text style={[styles.small, { fontFamily: ui.font, color: ui.color("ink") }]}>{COPY.checkAll}</Text>
        </Pressable>
      </View>
      {categories.map((category) => {
        // The household's list: no group is passed.
        const check = effectiveCheck(category.checks);
        return (
          <View key={category.id} style={[styles.row, wide && styles.rowWide, { borderTopColor: ui.color("hairline") }]} testID={`category-row-${category.id}`}>
            <MonoTile monogram={category.monogram} source={category.source} icon={upstreamCategoryIcon(category.slug, category.source)} />
            <View style={[styles.label, wide && styles.labelWide]}>
              <ui.Link href={`/categories/${category.id}`} testID={`category-open-${category.id}`}>
                <Text numberOfLines={1} style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 21, fontWeight: "600", color: ui.color("ink") }}>
                  {category.label}
                </Text>
                {wide ? (
                  <Text style={{ fontFamily: ui.font, fontSize: 12, lineHeight: 18, color: ui.color("ink-3") }}>
                    {COPY.rowDetail(category.activeDomainCount, verdictDetailText(check))}
                  </Text>
                ) : null}
              </ui.Link>
            </View>
            <VerdictChip style={verdictStyle(check)} />
            <View style={styles.toggle}>
              <ui.Toggle
                label={COPY.checkingLabel(category.label)}
                title={COPY.checkingTitle}
                on={category.enabled}
                onToggle={() => onToggle(category)}
                disabled={busy}
                testID={`category-toggle-${category.id}`}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stance: { margin: 0, maxWidth: 600, fontSize: 12.5, lineHeight: 20 },
  card: { overflow: "hidden", borderRadius: 12, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth: 1 },
  count: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  checkAll: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  small: { fontSize: 12.5, lineHeight: 18.75, fontWeight: "600" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1 },
  rowWide: { gap: 12, paddingHorizontal: 18 },
  label: { flex: 1, minWidth: 60 },
  labelWide: { minWidth: 140 },
  toggle: { marginLeft: "auto", flexShrink: 0 },
});
