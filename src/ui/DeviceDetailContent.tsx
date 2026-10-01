"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { deviceDetail, groupHref, presenceTone, type DeviceDetailRow } from "@/lib/device-detail";
import type { Device, Group } from "@/lib/types";

import { DeviceMark } from "./DeviceMark";
import { useUI } from "./UIContext";
import { useWide } from "./use-wide";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/** A device's detail: its presence at a glance, then its Device and Connection sections, side by side when wide. */
export function DeviceDetailContent({
  device,
  group,
  networks,
  timezone,
  now,
}: {
  device: Device;
  group: Group | null | undefined;
  networks: { id: string; name: string; vlanId: number }[];
  timezone: string;
  now: Date;
}) {
  const ui = useUI();
  const wide = useWide();
  const detail = deviceDetail(device, group, networks, timezone, now);
  const tone = presenceTone(detail.presence);
  const card = { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") };
  return (
    <View style={styles.stack} testID="device-detail">
      <View style={[styles.header, card]}>
        <DeviceMark hostname={device.hostname} size="detail" />
        <View style={styles.headerWords}>
          <View style={styles.titleRow}>
            <Text role="heading" aria-level={2} style={[styles.name, { fontFamily: ui.font, color: ui.color("ink") }]}>
              {detail.name}
            </Text>
            <View style={[styles.pill, { backgroundColor: ui.color(tone.fill) }]} testID="device-presence">
              <View aria-hidden style={[styles.dot, { backgroundColor: ui.color(tone.ink) }]} />
              <Text style={[styles.pillText, { fontFamily: ui.font, color: ui.color(tone.ink) }]}>{detail.status}</Text>
            </View>
          </View>
          <Text style={[styles.body, styles.summary, { fontFamily: ui.font, color: ui.color("muted") }]}>{detail.summary}</Text>
        </View>
      </View>
      <View style={wide ? styles.columns : styles.stack}>
        {detail.sections.map((section) => (
          <View key={section.title} role="region" aria-label={section.title} style={[styles.section, card, wide && styles.column]}>
            <Text role="heading" aria-level={3} style={[styles.body, styles.sectionTitle, { fontFamily: ui.font, color: ui.color("ink") }]}>
              {section.title}
            </Text>
            {section.rows.map((row) => (
              <Row key={row.label} row={row} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({ row }: { row: DeviceDetailRow }) {
  const ui = useUI();
  const value = [styles.body, styles.value, { fontFamily: row.mono ? MONO : ui.font, color: ui.color(row.group ? "accent" : "ink") }];
  return (
    <View style={[styles.row, { borderTopColor: ui.color("hairline") }]}>
      <Text style={[styles.body, styles.label, { fontFamily: ui.font, color: ui.color("muted") }]}>{row.label}</Text>
      {row.group ? (
        <ui.Link href={groupHref(row.group)}>
          <Text style={value}>{row.value}</Text>
        </ui.Link>
      ) : (
        <Text style={value} selectable={row.mono}>
          {row.value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  column: { flex: 1, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 12, borderWidth: 1, padding: 18 },
  headerWords: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  name: { fontSize: 21, lineHeight: 31.5, fontWeight: "600", letterSpacing: -0.5 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21 },
  summary: { marginTop: 4 },
  section: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, overflow: "hidden" },
  sectionTitle: { paddingVertical: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, minHeight: 44, borderTopWidth: 1, paddingVertical: 12 },
  label: { flexShrink: 0 },
  value: { flexShrink: 1, minWidth: 0, textAlign: "right" },
});
