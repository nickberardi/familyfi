"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { DEVICES_COPY as COPY, quarantineTitle } from "@/lib/device-list";

import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * Whether unassigned devices stay off the internet. The control names the state quarantine is in:
 * it once named the action, reading "Off" while quarantine was enforced, which is the one reading a
 * household must not get wrong here. Quarantine is also the built-in rule on Rules; while that rule
 * is paused, `pausedLine` says until when and Resume ends the pause.
 */
export function QuarantineCard({
  enforced,
  disabled,
  onToggle,
  pausedLine,
  onResume,
}: {
  enforced: boolean;
  disabled?: boolean;
  onToggle: () => void;
  /** "Paused until 8:00 PM by Nick" while the quarantine rule is paused; null otherwise. */
  pausedLine?: string | null;
  onResume?: () => void;
}) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14 };
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="quarantine-card">
      <View style={styles.words}>
        <Text style={[text, styles.title, { color: ui.color(enforced && !pausedLine ? "ink" : "paused") }]}>{quarantineTitle(enforced)}</Text>
        <Text style={[text, styles.body, { color: ui.color("muted") }]}>{COPY.quarantineBody}</Text>
        {pausedLine ? (
          <Text style={[text, styles.body, { color: ui.color("ink-2") }]} testID="quarantine-paused">
            {pausedLine}
          </Text>
        ) : null}
      </View>
      {pausedLine && onResume ? (
        <Pressable
          role="button"
          aria-disabled={disabled}
          disabled={disabled}
          testID="quarantine-resume"
          onPress={onResume}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: ui.color("accent") },
            disabled && { opacity: 0.4 },
            pressed && !disabled && { opacity: PRESS_OPACITY },
          ]}
        >
          <Text style={[text, styles.buttonLabel, { color: ui.color("ink-on-fill") }]}>{COPY.quarantineResume}</Text>
        </Pressable>
      ) : null}
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
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  buttonLabel: { fontWeight: "600", lineHeight: 21 },
});
