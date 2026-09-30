import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { accessColor, cardNoteLine, cardStateLabel, roleTag } from "@/lib/display";
import { groupMonogram } from "@/lib/internet-zone";
import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";

import { tokenOf, useUI } from "./UIContext";

/**
 * A group card's identity, shared by every client: a things group's monogram tile, the name and
 * role, what its internet is doing now (in the access colour), and the note line. The card
 * around it (open or closed, marks, actions) belongs to the caller.
 */
export function GroupCardHeader({
  group,
  windows,
  timezone,
  now,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
}) {
  const ui = useUI();
  const { width } = useWindowDimensions();
  const monogram = groupMonogram(group);
  const stateColor = ui.color(tokenOf(accessColor(group.access)));
  const body = { fontFamily: ui.font, fontSize: 14 };

  return (
    <View style={styles.row}>
      {group.kind === "things" ? (
        <View style={[styles.tile, { backgroundColor: ui.color("mark") }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
          <Text style={{ fontFamily: ui.font, fontSize: width >= 768 ? 17 : 19, fontWeight: "600", letterSpacing: -0.3, color: ui.color("ink") }}>
            {group.name}
          </Text>
          <Text style={[body, { color: ui.color("ink-2") }]}>{roleTag(group)}</Text>
        </View>
        <View style={styles.state}>
          <View style={[styles.dot, { backgroundColor: stateColor }]} />
          <Text style={[body, styles.shrink, { color: stateColor }]}>{cardStateLabel(group, windows, timezone, now)}</Text>
        </View>
        <Text style={[body, { marginTop: 2, color: ui.color("ink-3") }]}>{cardNoteLine(group, windows)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 },
  tile: { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  words: { flex: 1, minWidth: 0 },
  title: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 8 },
  state: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  shrink: { flexShrink: 1 },
});
