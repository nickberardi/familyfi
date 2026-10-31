"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { deviceDetail, groupHref, presenceTone, type DeviceDetailRow } from "@/lib/device-detail";
import type { Device, Group } from "@/lib/types";

import { DeviceMark } from "./DeviceMark";
import { useUI } from "./UIContext";
import { useWide } from "./use-wide";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * A device's detail: its presence at a glance, then its Device and Connection sections, side by side when wide.
 * `compact` is the web's device modal: the modal's title carries the name, and the sections drop their cards.
 */
export function DeviceDetailContent({
  device,
  group,
  networks,
  timezone,
  now,
  compact = false,
}: {
  device: Device;
  group: Group | null | undefined;
  networks: { id: string; name: string; vlanId: number }[];
  timezone: string;
  now: Date;
  compact?: boolean;
}) {
  const ui = useUI();
  const wide = useWide();
  const detail = deviceDetail(device, group, networks, timezone, now);
  const tone = presenceTone(detail.presence);
  const card = { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") };
  const pill = (
    <View style={[styles.pill, compact && styles.compactPill, { backgroundColor: ui.color(tone.fill) }]} testID="device-presence">
      <View aria-hidden style={[styles.dot, { backgroundColor: ui.color(tone.ink) }]} />
      <Text style={[styles.pillText, { fontFamily: ui.font, color: ui.color(tone.ink) }]}>{detail.status}</Text>
    </View>
  );
  return (
    <View style={styles.stack} testID="device-detail">
      {compact ? (
        <View style={styles.compactHeader}>
          <DeviceMark hostname={device.hostname} size="detail" />
          <View style={styles.compactWords}>
            {pill}
            <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("muted") }]}>{detail.summary}</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.header, card]}>
          <DeviceMark hostname={device.hostname} size="detail" />
          <View style={styles.headerWords}>
            <View style={styles.titleRow}>
              <Text role="heading" aria-level={2} style={[styles.name, { fontFamily: ui.font, color: ui.color("ink") }]}>
                {detail.name}
              </Text>
              {pill}
            </View>
            <Text style={[styles.body, styles.summary, { fontFamily: ui.font, color: ui.color("muted") }]}>{detail.summary}</Text>
          </View>
        </View>
      )}
      <View style={wide ? (compact ? styles.compactColumns : styles.columns) : styles.stack}>
        {detail.sections.map((section) => (
          <View
            key={section.title}
            role="region"
            aria-label={section.title}
            style={[compact ? styles.compactSection : [styles.section, card], wide && styles.column]}
          >
            <Text
              role="heading"
              aria-level={3}
              style={[styles.body, compact ? styles.compactSectionTitle : styles.sectionTitle, { fontFamily: ui.font, color: ui.color("ink") }]}
            >
              {section.title}
            </Text>
            {section.rows.map((row) => (
              <Row key={row.label} row={row} compact={compact} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Row({ row, compact }: { row: DeviceDetailRow; compact: boolean }) {
  const ui = useUI();
  // In the modal's narrower columns an address keeps to one line.
  const keepWhole = compact && row.mono;
  const value = [styles.body, styles.value, keepWhole && styles.whole, { fontFamily: row.mono ? MONO : ui.font, color: ui.color(row.group ? "accent" : "ink") }];
  return (
    <View style={[styles.row, compact && styles.compactRow, { borderTopColor: ui.color("hairline") }]}>
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
  name: { fontSize: 21, lineHeight: 25, fontWeight: "600", letterSpacing: -0.5 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21 },
  summary: { marginTop: 4 },
  section: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, overflow: "hidden" },
  sectionTitle: { paddingVertical: 14, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, minHeight: 44, borderTopWidth: 1, paddingVertical: 11 },
  label: { flexShrink: 0 },
  compactHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  compactWords: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 4 },
  compactPill: { paddingVertical: 0 },
  compactColumns: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  compactSection: { minWidth: 0 },
  compactSectionTitle: { marginBottom: 4, fontWeight: "600" },
  whole: { flexShrink: 0 },
  compactRow: { minHeight: 0, gap: 10, paddingVertical: 6 },
  value: { flexShrink: 1, minWidth: 0, textAlign: "right" },
});
