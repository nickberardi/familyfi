"use client";

import { StyleSheet, Text } from "react-native";

import { useUI } from "./UIContext";
import { useWide } from "./use-wide";

/** A page with nothing on it yet, in the card's place: "Nothing here yet." */
export function EmptyCard({ text = "Nothing here yet." }: { text?: string }) {
  const ui = useUI();
  const wide = useWide();
  return (
    <Text
      style={[
        styles.card,
        { backgroundColor: ui.color("card"), color: ui.color("muted"), fontFamily: ui.font },
        // Cards are outlined on wide screens, as on the web's md breakpoint.
        wide && { borderWidth: 1, borderColor: ui.color("hairline-card") },
      ]}
    >
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 18, fontSize: 14, lineHeight: 21, overflow: "hidden" },
});
