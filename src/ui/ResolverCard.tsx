"use client";

import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import type { ApiRequest } from "@/lib/api-client";
import { resolverScheduleLine, toggleProbeDay, type UpstreamResolverSettings } from "@/lib/upstream";
import { CATEGORIES_COPY, canSaveResolverUrl, clearResolver, saveResolverUrl, updateResolver } from "@/lib/upstream-writes";

import { Button } from "./Button";
import { useUI } from "./UIContext";

const COPY = CATEGORIES_COPY.resolver;
const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * The household's DNS-over-HTTPS endpoint, shown in full, and when checks run. Seeing what you
 * configured is the point: a mistyped profile id is otherwise invisible behind an unknown verdict.
 */
export function ResolverCard({
  resolver,
  request,
  timezone,
  enabled = true,
  onChanged,
}: {
  resolver: UpstreamResolverSettings | null;
  request: ApiRequest;
  timezone: string;
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
  const canSave = !off && canSaveResolverUrl(url);
  const small = (size: number, lineHeight: number, token = "ink-3") => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });

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

  async function setChecking(on: boolean) {
    if (!resolver) return;
    if (!on && !(await ui.confirm({ title: COPY.turnOff.title, message: COPY.turnOff.message, confirmLabel: COPY.turnOff.confirm, destructive: true }))) return;
    void run(() => updateResolver(request, { probeEnabled: on }), COPY.toggleFailed);
  }

  async function remove() {
    if (!(await ui.confirm({ title: COPY.removeConfirm.title, message: COPY.removeConfirm.message, confirmLabel: COPY.removeConfirm.confirm, destructive: true }))) return;
    void run(() => clearResolver(request), COPY.clearFailed);
  }

  function save() {
    if (!canSave) return;
    void run(
      () =>
        saveResolverUrl(request, url).then(() => {
          setPasting(false);
          setUrl("");
        }),
      COPY.saveFailed,
    );
  }

  return (
    <View
      role="region"
      aria-labelledby="resolver-card-title"
      style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}
      testID="resolver-card"
    >
      <View style={[styles.head, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text role="heading" aria-level={2} id="resolver-card-title" style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {COPY.title}
        </Text>
        {resolver?.url ? (
          <ui.Toggle
            label={COPY.checking}
            on={resolver.probeEnabled}
            onToggle={() => void setChecking(!resolver.probeEnabled)}
            onLabel={COPY.checkingOn}
            offLabel={COPY.checkingOff}
            disabled={off}
            testID="resolver-checking"
          />
        ) : null}
      </View>
      <View style={styles.body}>
        {resolver?.url && !pasting ? <Text style={{ fontFamily: MONO, fontSize: 14, lineHeight: 20, color: ui.color("ink") }}>{resolver.url}</Text> : null}
        {!resolver?.url && !pasting ? (
          <Text style={small(14, 20)}>{resolver?.source === "dhcp" ? COPY.dhcp : resolver?.reason ?? COPY.unavailable}</Text>
        ) : null}
        {resolver?.networks?.map((network) => (
          <Text key={network.id} style={[small(14, 20), styles.network]}>
            {network.name}: {network.reason ?? network.servers.join(", ")}
          </Text>
        ))}
        <Text style={[small(14, 20), styles.note]}>{COPY.note}</Text>

        {resolver ? (
          <View style={[styles.schedule, { borderTopColor: ui.color("hairline") }]}>
            <View style={styles.scheduleHead}>
              <View style={styles.grow}>
                <Text style={[small(14, 20, "ink"), styles.bold]}>{COPY.schedule}</Text>
                <Text style={[small(14, 20), styles.scheduleLine]}>{resolverScheduleLine(resolver, timezone, new Date())}</Text>
              </View>
              <ui.TimeField
                label={COPY.time}
                value={resolver.probeTime}
                disabled={off}
                onChange={(next) => void run(() => updateResolver(request, { probeTime: next }), COPY.timeFailed)}
                testID="resolver-time"
              />
            </View>
            <View style={styles.days}>
              <ui.DayPicker
                days={resolver.probeDays}
                onToggle={(day) => void run(() => updateResolver(request, { probeDays: toggleProbeDay(resolver.probeDays, day) }), COPY.daysFailed)}
                disabled={off}
                testID="resolver-day"
              />
            </View>
          </View>
        ) : null}

        {pasting ? (
          <View style={styles.paste}>
            <ui.TextField label={COPY.endpoint} value={url} onChange={setUrl} placeholder={COPY.placeholder} onSubmit={save} url disabled={!enabled} testID="resolver-url" />
            <View style={styles.buttons}>
              <Button
                kind="cancel"
                size="md"
                label={COPY.cancel}
                onPress={() => {
                  setPasting(false);
                  setUrl("");
                  setError("");
                }}
                testID="resolver-cancel"
              />
              <Button kind="primary" size="md" label={COPY.save} onPress={save} disabled={!canSave} busy={busy} testID="resolver-save" />
            </View>
          </View>
        ) : (
          <View style={[styles.buttons, styles.actions]}>
            <Button kind="secondary" size="md" label={resolver?.url ? COPY.replace : COPY.add} onPress={() => setPasting(true)} disabled={!enabled} testID="resolver-paste" />
            {resolver?.url ? <Button kind="destructive" size="md" label={COPY.remove} onPress={() => void remove()} disabled={off} testID="resolver-remove" /> : null}
          </View>
        )}

        {error ? <Text style={[small(14, 20, "danger"), styles.error]}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", borderRadius: 12, borderWidth: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12, minHeight: 51, borderBottomWidth: 1 },
  title: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  body: { paddingHorizontal: 18, paddingVertical: 16 },
  network: { marginTop: 4 },
  note: { marginTop: 6 },
  schedule: { marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  scheduleHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  scheduleLine: { marginTop: 2 },
  days: { marginTop: 10 },
  paste: { marginTop: 12, gap: 8 },
  buttons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  actions: { marginTop: 12 },
  bold: { fontWeight: "600" },
  error: { marginTop: 8 },
});
