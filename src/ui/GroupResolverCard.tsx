"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import {
  GROUP_RESOLVER_COPY as COPY,
  canSaveGroupResolver,
  groupResolverNetworkLine,
  groupResolverSummary,
  removeGroupResolver,
  saveGroupResolver,
  type GroupResolver,
} from "@/lib/group-resolver";

import { PRESS_OPACITY, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * A group's own DNS-over-HTTPS endpoint, from the design's member view, shared by every client.
 * Reporting only: it changes where this group's category checks are measured, never what is
 * blocked (`src/lib/group-resolver.ts`).
 */
export function GroupResolverCard({
  groupId,
  groupName,
  dohOverrideUrl,
  resolver,
  request,
  enabled = true,
  onChanged,
}: {
  groupId: string;
  groupName: string;
  dohOverrideUrl: string | null;
  resolver: GroupResolver | null;
  request: ApiRequest;
  /** False while the household is stale, so nothing is sent. */
  enabled?: boolean;
  onChanged: () => void;
}) {
  const ui = useUI();
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const off = busy || !enabled;
  const canSave = !off && canSaveGroupResolver(url);
  const small = (size: number, lineHeight: number) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color("ink-3") });

  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!canSave) return;
    void run(
      () =>
        saveGroupResolver(request, groupId, url).then(() => {
          setPasting(false);
          setUrl("");
        }),
      COPY.saveFailed,
    );
  }

  const outline = (label: string, tone: "accent" | "danger" | "ink-3", onPress: () => void, testID?: string, size: "sm" | "md" = "sm") => (
    <Pressable
      role="button"
      // Cancel always works, even while a save is in flight; the others wait for it.
      aria-disabled={off && tone !== "ink-3"}
      disabled={off && tone !== "ink-3"}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [size === "sm" ? styles.small : styles.medium, { borderColor: ui.color("control-line") }, pressed && { opacity: PRESS_OPACITY }]}
    >
      <Text style={[size === "sm" ? styles.smallLabel : styles.mediumLabel, { fontFamily: ui.font, color: ui.color(tone) }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View role="region" aria-label={COPY.title} style={[styles.card, { borderColor: ui.color("hairline-card"), backgroundColor: ui.color("card") }]} testID="group-resolver">
      <Text role="heading" aria-level={2} style={[styles.title, { fontFamily: ui.font, color: ui.color("ink"), borderBottomColor: ui.color("hairline-card") }]}>
        {COPY.title}
      </Text>
      <View style={styles.content}>
        {pasting ? (
          <View style={styles.paste}>
            <ui.TextField label={COPY.fieldLabel(groupName)} value={url} onChange={setUrl} placeholder={COPY.placeholder} onSubmit={save} url testID="group-resolver-url" />
            <View style={styles.row}>
              <Pressable
                role="button"
                aria-disabled={!canSave}
                disabled={!canSave}
                onPress={save}
                testID="group-resolver-save"
                style={({ pressed }) => [styles.medium, styles.filled, { backgroundColor: ui.color(canSave ? "accent" : "field-strong") }, pressed && canSave && { opacity: PRESS_OPACITY }]}
              >
                <Text style={[styles.mediumLabel, { fontFamily: ui.font, color: ui.color(canSave ? "ink-on-fill" : "locked") }]}>{COPY.save}</Text>
              </Pressable>
              {outline(COPY.cancel, "ink-3", () => (setPasting(false), setUrl(""), setError("")), "group-resolver-cancel", "md")}
            </View>
          </View>
        ) : dohOverrideUrl ? (
          <>
            <Text selectable style={[styles.url, { color: ui.color("ink") }]}>
              {dohOverrideUrl}
            </Text>
            <Text style={[small(12, 18), styles.note]}>{COPY.overrideNote(groupName)}</Text>
            <View style={[styles.row, styles.actions]}>
              {outline(COPY.replace, "accent", () => setPasting(true), "group-resolver-replace")}
              {outline(COPY.remove, "danger", () => void run(() => removeGroupResolver(request, groupId), COPY.removeFailed), "group-resolver-remove")}
            </View>
          </>
        ) : (
          <>
            <Text style={small(12.5, 20.3125)}>{groupResolverSummary(resolver)}</Text>
            {resolver?.networks.map((network) => (
              <Text key={network.id} style={[small(12, 18), styles.note]}>
                {groupResolverNetworkLine(network)}
              </Text>
            ))}
            <View style={[styles.row, styles.actions]}>{outline(COPY.override, "accent", () => setPasting(true), "group-resolver-override")}</View>
          </>
        )}
        {!pasting ? <Text style={[small(12, 18), styles.hostNote]}>{COPY.hostNote}</Text> : null}
        {error ? <Text style={[styles.error, { fontFamily: ui.font, color: ui.color("danger") }]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", borderRadius: 12, borderWidth: 1 },
  title: { borderBottomWidth: 1, paddingHorizontal: 18, paddingVertical: 16, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  content: { paddingHorizontal: 18, paddingVertical: 16 },
  paste: { gap: 8 },
  // Stretched, as the web's flex rows are, so a filled button takes its outlined neighbour's height.
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actions: { marginTop: 10 },
  small: { justifyContent: "center", borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  smallLabel: { fontSize: 12.5, lineHeight: 18.75, fontWeight: "600" },
  medium: { justifyContent: "center", borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  filled: { borderWidth: 0 },
  mediumLabel: { fontSize: 13, lineHeight: 19.5, fontWeight: "600" },
  // A long endpoint breaks anywhere on the web, as it always has; natively it wraps at its slashes.
  url: { fontFamily: MONO, fontSize: 13, lineHeight: 19.5, ...Platform.select({ web: { wordBreak: "break-all" } as object, default: {} }) },
  note: { marginTop: 4 },
  hostNote: { marginTop: 8 },
  error: { marginTop: 8, fontSize: 13, lineHeight: 19.5 },
});
