"use client";

import { StyleSheet, Text, View } from "react-native";

import { DEVICES_COPY as COPY, quarantineTitle } from "@/lib/device-list";

import { useUI } from "./UIContext";

/**
 * Whether unassigned devices stay off the internet. The control names the state quarantine is in:
 * it once named the action, reading "Off" while quarantine was enforced, which is the one reading a
 * household must not get wrong here.
 */
export function QuarantineCard({ enforced, disabled, onToggle }: { enforced: boolean; disabled?: boolean; onToggle: () => void }) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14 };
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="quarantine-card">
      <View style={styles.words}>
        <Text style={[text, styles.title, { color: ui.color(enforced ? "ink" : "paused") }]}>{quarantineTitle(enforced)}</Text>
        <Text style={[text, styles.body, { color: ui.color("muted") }]}>{COPY.quarantineBody}</Text>
      </View>
      <ui.Toggle
        label={COPY.quarantineLabel}
        on={enforced}
        onToggle={onToggle}
        onLabel={COPY.quarantineOn}
        offLabel={COPY.quarantineOff}
        disabled={disabled}
        testID="quarantine-toggle"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12 },
  words: { flex: 1, minWidth: 0 },
  title: { fontWeight: "600", lineHeight: 21 },
  body: { marginTop: 2, lineHeight: 20 },
});
