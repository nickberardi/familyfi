"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import {
  activeDomainList,
  categoryCheckLine,
  domainListAfter,
  domainVerdictStyle,
  effectiveCheck,
  enabledNoteText,
  sourceNoteText,
  verdictStyle,
  type UpstreamCategoryRow,
} from "@/lib/upstream";
import { upstreamCategoryIcon } from "@/lib/upstream-domains";
import { CATEGORIES_COPY, checkCategory, deleteCategory, deleteCategoryCopy, patchCategoryDomains, setCategoryChecking } from "@/lib/upstream-writes";

import { MonoTile } from "./MonoTile";
import { NetworkCheckDetails } from "./NetworkCheckResults";
import { PRESS_OPACITY, useUI } from "./UIContext";
import { VerdictChip } from "./VerdictChip";

const COPY = CATEGORIES_COPY.detail;
const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * A category's page: its latest verdict and where it was measured, whether it is checked, and its
 * domains. Every domain edit sends the whole active list; the server decides whether leaving one out
 * strikes it through (seeded) or deletes it (added here), so no client has to know which.
 */
export function CategoryDetailContent({
  category,
  request,
  enabled = true,
  onChanged,
  onDeleted,
}: {
  category: UpstreamCategoryRow;
  request: ApiRequest;
  /** False while the household is stale, so nothing is sent. */
  enabled?: boolean;
  /** Reload the category after a change. */
  onChanged: () => Promise<unknown> | void;
  onDeleted: () => void;
}) {
  const ui = useUI();
  const [newDomain, setNewDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const off = busy || !enabled;
  const check = effectiveCheck(category.checks);
  const active = activeDomainList(category.domains);
  const small = (size: number, lineHeight: number, token = "ink-3") => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
  const card = { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") };

  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const value = newDomain.trim();
    if (!value || off) return;
    void run(() => patchCategoryDomains(request, category, [...active, value]), COPY.addFailed).then(() => setNewDomain(""));
  }

  async function remove() {
    if (!(await ui.confirm({ ...confirmCopy(category), destructive: true }))) return;
    void run(async () => {
      await deleteCategory(request, category);
      onDeleted();
    }, COPY.deleteFailed);
  }

  const outline = (label: string, onPress: () => void, testID: string) => (
    <Pressable
      role="button"
      aria-disabled={off}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.outline, { borderColor: ui.color("control-line") }, off && { opacity: 0.4 }, pressed && !off && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[small(12.5, 18, "ink"), styles.bold]}>{label}</Text>
    </Pressable>
  );

  const textButton = (label: string, token: string, onPress: () => void, testID: string, accessibleLabel?: string) => (
    <Pressable
      role="button"
      aria-label={accessibleLabel}
      aria-disabled={off}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [off && { opacity: 0.4 }, pressed && !off && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[small(12.5, 18, token), styles.bold]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.stack} testID="category-detail">
      <View style={[styles.card, styles.summary, card]}>
        <View style={styles.headRow}>
          <MonoTile monogram={category.monogram} source={category.source} icon={upstreamCategoryIcon(category.slug, category.source)} size="detail" />
          <View style={styles.headWords}>
            <Text role="heading" aria-level={1} style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
              {category.label}
            </Text>
            <Text style={[small(12.5, 18), styles.sourceNote]}>{sourceNoteText(category.source)}</Text>
          </View>
          <VerdictChip style={verdictStyle(check)} size="detail" testID="category-verdict" />
          {outline(COPY.checkNow, () => void run(() => checkCategory(request, category), COPY.checkFailed), "category-check-now")}
        </View>
        <Text style={[small(12.5, 18), styles.checkLine]}>{categoryCheckLine(check)}</Text>
        <NetworkCheckDetails check={check} />
        <View style={[styles.checking, { borderTopColor: ui.color("hairline") }]}>
          <ui.Toggle
            label={CATEGORIES_COPY.checkingLabel(category.label)}
            on={category.enabled}
            onToggle={() => void run(() => setCategoryChecking(request, category, !category.enabled), CATEGORIES_COPY.toggleFailed)}
            onLabel={COPY.checkingOn}
            offLabel={COPY.checkingOff}
            disabled={off}
            testID="category-checking"
          />
          <Text style={small(12.5, 18)}>{enabledNoteText(category.enabled)}</Text>
          <View style={styles.grow} />
          {category.source === "user" ? textButton(COPY.deleteCategory, "danger", () => void remove(), "category-delete") : null}
        </View>
      </View>

      <View style={[styles.card, styles.domains, card]}>
        <Text role="heading" aria-level={2} style={[styles.domainsTitle, { fontFamily: ui.font, color: ui.color("ink"), borderBottomColor: ui.color("hairline-card") }]}>
          {COPY.domains}
        </Text>
        {category.domains.map((domain) => (
          <View key={domain.id} style={[styles.domainRow, { borderTopColor: ui.color("hairline") }]} testID={`category-domain-${domain.domain}`}>
            <Text
              style={[
                styles.domainName,
                { fontFamily: MONO, color: ui.color(domain.removed ? "ink-struck" : "ink") },
                domain.removed && styles.struck,
              ]}
            >
              {domain.domain}
            </Text>
            <VerdictChip style={domainVerdictStyle(domain, check)} />
            {textButton(
              domain.removed ? COPY.restore : COPY.remove,
              "accent",
              () => void run(() => patchCategoryDomains(request, category, domainListAfter(active, domain)), domain.removed ? COPY.restoreFailed : COPY.removeFailed),
              `category-domain-${domain.removed ? "restore" : "remove"}-${domain.domain}`,
            )}
          </View>
        ))}
        <View style={[styles.addRow, { borderTopColor: ui.color("hairline") }]}>
          <View style={styles.grow}>
            <ui.TextField label={COPY.addLabel} value={newDomain} onChange={setNewDomain} placeholder={COPY.addPlaceholder} mono onSubmit={add} disabled={!enabled} testID="category-domain-add" />
          </View>
          <Pressable
            role="button"
            aria-disabled={off || !newDomain.trim()}
            disabled={off || !newDomain.trim()}
            onPress={add}
            testID="category-domain-add-button"
            style={({ pressed }) => [styles.add, { backgroundColor: ui.color("accent") }, (off || !newDomain.trim()) && { opacity: 0.4 }, pressed && { opacity: PRESS_OPACITY }]}
          >
            <Text style={[small(13, 19.5, "ink-on-fill"), styles.bold]}>{COPY.add}</Text>
          </Pressable>
        </View>
        {/* Lists are uncapped by decision; this is how growth is priced. */}
        <Text style={[small(12, 18, "ink-4"), styles.cost]}>{category.costNote}</Text>
      </View>

      {error ? <Text style={small(13, 19.5, "danger")}>{error}</Text> : null}
    </View>
  );
}

function confirmCopy(category: Pick<UpstreamCategoryRow, "label">) {
  const copy = deleteCategoryCopy(category);
  return { title: copy.title, message: copy.message, confirmLabel: copy.confirm };
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  card: { borderRadius: 12, borderWidth: 1 },
  summary: { padding: 18 },
  headRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 },
  headWords: { flex: 1, minWidth: 200 },
  title: { margin: 0, fontSize: 18, lineHeight: 27, fontWeight: "700", letterSpacing: -0.45 },
  sourceNote: { marginTop: 2 },
  checkLine: { marginTop: 8 },
  checking: { marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, paddingTop: 14, borderTopWidth: 1 },
  grow: { flex: 1, minWidth: 0 },
  outline: { flexShrink: 0, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  bold: { fontWeight: "600" },
  domains: { overflow: "hidden" },
  domainsTitle: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  domainRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderTopWidth: 1 },
  domainName: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19.5 },
  struck: { textDecorationLine: "line-through" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 13, borderTopWidth: 1 },
  add: { flexShrink: 0, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  cost: { paddingHorizontal: 18, paddingBottom: 14, paddingTop: 2 },
});
