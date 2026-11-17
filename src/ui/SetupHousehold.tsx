"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { PendingEnrollment } from "@/lib/companion-pairing";
import {
  HIDDEN_KEY,
  SETUP_ACTIONS,
  pendingHouseholdNote,
  pendingHouseholdSections,
  trustExplanation,
  type PendingRow,
} from "@/lib/companion-setup";

import { SETUP } from "./SetupScreen";
import { PRESS_OPACITY } from "./UIContext";

/**
 * "Is this your household?": what the pairing code said and what the household proved, then what
 * matched and what trusting it means (familyfi-ios `ConfirmIdentityView`). Shared by the FamilyFi
 * app and FamilyFi Me; each draws its own Trust and Not my household actions under it.
 */
export function SetupHousehold({ pending }: { pending: PendingEnrollment }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      {pendingHouseholdSections(pending).map((section) => (
        <View key={section.title} style={styles.well}>
          <Text style={styles.label}>{section.title}</Text>
          {section.rows.map((row) => (
            <Row
              key={row.label}
              row={row}
              revealed={revealed}
              onToggle={() => setRevealed(!revealed)}
            />
          ))}
        </View>
      ))}
      <Text style={styles.note}>{pendingHouseholdNote(pending)}</Text>
      <Text style={styles.note}>{trustExplanation(pending)}</Text>
    </>
  );
}

/** One detail: its label, then the value, the one-time key hidden until revealed. */
function Row({
  row,
  revealed,
  onToggle,
}: {
  row: PendingRow;
  revealed: boolean;
  onToggle: () => void;
}) {
  const testID = `identity-${row.label.toLowerCase().replace(/ /g, "-")}`;
  const value = (
    <View style={styles.rowText}>
      <Text style={styles.label}>{row.label}</Text>
      <Text
        style={row.mono ? styles.mono : styles.value}
        selectable
        accessibilityLabel={row.label}
        testID={row.label === "Household" ? "setup-household" : testID}
      >
        {row.secret && !revealed ? HIDDEN_KEY : row.value}
      </Text>
    </View>
  );
  if (!row.secret) return value;
  return (
    <View style={styles.secret}>
      {value}
      <Pressable
        role="button"
        aria-expanded={revealed}
        onPress={onToggle}
        style={({ pressed }) => [styles.reveal, pressed && { opacity: PRESS_OPACITY }]}
        testID="setup-reveal-key"
      >
        <Text style={styles.revealText}>
          {revealed ? SETUP_ACTIONS.hide : SETUP_ACTIONS.reveal}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  well: { gap: 10, padding: 14, borderRadius: 12, backgroundColor: SETUP.well },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: SETUP.ink2 },
  rowText: { flex: 1, gap: 2 },
  value: { fontSize: 14, lineHeight: 20, color: SETUP.ink },
  mono: {
    fontSize: 14,
    lineHeight: 20,
    color: SETUP.ink,
    fontFamily: SETUP.mono,
  },
  secret: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  reveal: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  revealText: { fontSize: 14, lineHeight: 20, color: SETUP.accent },
  note: { fontSize: 14, lineHeight: 20, color: SETUP.ink2 },
});
