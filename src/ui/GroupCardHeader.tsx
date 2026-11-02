"use client";

import { StyleSheet, Text, View } from "react-native";

import { cardNoteLine } from "@/lib/display";
import { groupDetailColor, groupStatusParts } from "@/lib/group-actions";
import { groupMonogram, personMonogram } from "@/lib/internet-zone";
import type { InternetWindow } from "@/lib/rule-windows";
import type { Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { StatusBadge } from "./StatusBadge";
import { tokenOf, useUI } from "./UIContext";
import { useWide } from "./use-wide";

/**
 * A group card's identity, shared by every client: a things group's monogram tile, the name with
 * its Online or Blocked badge, the line saying why (`groupStatusParts`, grey unless someone blocked
 * or unblocked it), and the note line. The card
 * around it (open or closed, marks, actions) belongs to the caller. A stacked card shows a person's
 * monogram too (`mark`), and its note in the card's body instead (`note={false}`).
 */
export function GroupCardHeader({
  group,
  rules,
  windows,
  timezone,
  now,
  note = true,
  mark = false,
}: {
  group: Group;
  rules: Rule[];
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  /** The note line under the state. */
  note?: boolean;
  /** A person's monogram as well as a things group's. */
  mark?: boolean;
}) {
  const ui = useUI();
  const monogram = groupMonogram(group);
  const status = groupStatusParts(group, rules, timezone, now);
  const body = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const wide = useWide();

  return (
    <View style={styles.row}>
      {group.kind === "family" && mark ? (
        <View style={[styles.tile, styles.person, { backgroundColor: ui.color("person-fill") }]} aria-hidden>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontFamily: ui.font, fontWeight: "600", color: ui.color("person-ink"), fontSize: personMonogram(group).length > 2 ? 12 : 17 }}
          >
            {personMonogram(group)}
          </Text>
        </View>
      ) : null}
      {group.kind === "things" ? (
        <View style={[styles.tile, { backgroundColor: ui.color("mark") }]} aria-hidden>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontFamily: ui.font, fontWeight: "700", letterSpacing: 0.35, color: ui.color("ink-on-fill"), fontSize: monogram.length > 2 ? 12 : 14 }}
          >
            {monogram}
          </Text>
        </View>
      ) : null}
      <View style={styles.words}>
        <View style={styles.title}>
          {/* The web's md breakpoint: 17 pt names on wide screens, 19 pt on phones. */}
          <Text
            style={{
              fontFamily: ui.font,
              fontSize: wide ? 17 : 19,
              lineHeight: wide ? 25.5 : 28.5,
              fontWeight: "600",
              // The web's tracking-tight, -0.025em.
              letterSpacing: wide ? -0.425 : -0.475,
              color: ui.color("ink"),
            }}
          >
            {group.name}
          </Text>
          <StatusBadge badge={status.badge} testID={`group-badge-${group.id}`} />
        </View>
        {status.detail ? <Text style={[body, styles.detail, { color: ui.color(tokenOf(groupDetailColor(status.change))) }]}>{status.detail}</Text> : null}
        {note ? <Text style={[body, { marginTop: 2, color: ui.color("ink-3") }]}>{cardNoteLine(group, windows)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 },
  tile: { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  person: { borderRadius: 22 },
  words: { flex: 1, minWidth: 0 },
  title: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 8, rowGap: 2 },
  detail: { marginTop: 2 },
});
