"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { SYNC_COPY as COPY, syncLogRows, syncStats } from "@/lib/sync-copy";
import type { SyncStatus } from "@/lib/types";

import { tokenOf, useUI } from "./UIContext";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * The Sync page below its header: the four tiles (policies FamilyFi owns, admin policies touched,
 * failing, last sweep), the log of current issues and changes, and what FamilyFi never touches.
 */
export function SyncContent({ sync, timezone, now }: { sync: SyncStatus | null; timezone: string; now?: Date }) {
  const ui = useUI();
  const text = (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
  const card = { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") };
  const rows = syncLogRows(sync, timezone);

  return (
    <View style={styles.stack} testID="sync-content">
      <View style={styles.tiles}>
        {syncStats(sync, now).map((stat) => (
          <View key={stat.label} style={[styles.card, styles.tile, card]} testID={`sync-stat-${stat.label}`}>
            <Text style={[text(14, 21, "muted"), styles.statLabel]}>{stat.label}</Text>
            <Text style={[text(26, 39, tokenOf(stat.ink)), styles.statValue]}>{stat.value}</Text>
            <Text style={[text(14, 21, "muted"), styles.statNote]}>{stat.note}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.card, styles.log, card]} testID="sync-log">
        <View style={[styles.row, styles.head, { backgroundColor: ui.color("field-soft") }]}>
          <Text style={[text(14, 21, "muted"), styles.when, styles.bold]}>{COPY.when}</Text>
          <Text style={[text(14, 21, "muted"), styles.action, styles.bold]}>{COPY.action}</Text>
          <Text style={[text(14, 21, "muted"), styles.result, styles.bold]}>{COPY.result}</Text>
        </View>
        {rows.length === 0 ? (
          <Text style={[text(14, 21, "muted"), styles.empty]}>{COPY.empty}</Text>
        ) : (
          rows.map((row) => (
            <View key={row.key} style={[styles.row, styles.entry, { borderTopColor: ui.color("hairline") }]} testID={`sync-row-${row.key}`}>
              <Text style={[text(14, 21, "muted"), styles.when]}>{row.when}</Text>
              <View style={styles.action}>
                <Text style={text(14, 21, "ink")}>{row.action}</Text>
                {row.detail ? (
                  <Text style={[text(14, 20, tokenOf(row.detailInk)), styles.detail, row.detailMono && { fontFamily: MONO }]}>{row.detail}</Text>
                ) : null}
              </View>
              <Text style={[text(14, 21, tokenOf(row.resultInk)), styles.result, styles.bold]}>{row.result}</Text>
            </View>
          ))
        )}
      </View>

      <Text style={[text(14, 20, "muted"), styles.card, styles.note, card]}>
        {COPY.ownership.before} <Text style={{ fontFamily: MONO }}>{COPY.ownership.prefix}</Text> {COPY.ownership.after}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  card: { borderRadius: 12, borderWidth: 1 },
  tile: { flexGrow: 1, flexBasis: 200, minWidth: 0, paddingHorizontal: 18, paddingVertical: 16 },
  statLabel: { fontWeight: "600", letterSpacing: 0.35, textTransform: "uppercase" },
  statValue: { marginTop: 6, fontWeight: "700", letterSpacing: -0.65 },
  statNote: { marginTop: 2 },
  log: { overflow: "hidden" },
  row: { flexDirection: "row", gap: 14, paddingHorizontal: 18 },
  head: { alignItems: "center", paddingVertical: 10 },
  entry: { alignItems: "flex-start", paddingVertical: 12, borderTopWidth: 1 },
  when: { flexBasis: 110, flexGrow: 0, flexShrink: 1, minWidth: 92, maxWidth: 128 },
  action: { flex: 1, minWidth: 0 },
  result: { flexBasis: 88, flexShrink: 0, minWidth: 80, maxWidth: 96, textAlign: "right" },
  bold: { fontWeight: "600" },
  detail: { marginTop: 2 },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
  note: { maxWidth: 780, paddingHorizontal: 18, paddingVertical: 14 },
});
