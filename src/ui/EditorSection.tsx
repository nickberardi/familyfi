"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useUI } from "./UIContext";

/** One part of an editor: a titled card with a line on what it decides. */
export function EditorSection({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const ui = useUI();
  return (
    <View style={[styles.section, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}>
      <View>
        <Text role="heading" aria-level={2} style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
          {title}
        </Text>
        <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-2") }]}>{note}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, borderRadius: 12, borderWidth: 1, padding: 18 },
  title: { margin: 0, fontSize: 15, lineHeight: 22.5, fontWeight: "600" },
  note: { marginTop: 2, fontSize: 14, lineHeight: 20 },
});
