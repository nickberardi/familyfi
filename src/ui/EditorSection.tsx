"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useUI } from "./UIContext";

/** One part of an editor: a titled card with a line on what it decides, and a badge beside the title, like "Experimental". */
export function EditorSection({ title, note, badge, children }: { title: string; note: string; badge?: string; children: ReactNode }) {
  const ui = useUI();
  return (
    <View style={[styles.section, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]}>
      <View>
        <View style={styles.heading}>
          <Text role="heading" aria-level={2} style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>
            {title}
          </Text>
          {badge ? (
            <Text style={[styles.badge, { fontFamily: ui.font, backgroundColor: ui.color("accent-fill"), color: ui.color("accent-hover"), borderWidth: 1, borderColor: ui.color("accent-line") }]}>{badge}</Text>
          ) : null}
        </View>
        <Text style={[styles.note, { fontFamily: ui.font, color: ui.color("ink-2") }]}>{note}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, borderRadius: 12, borderWidth: 1, padding: 18 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", overflow: "hidden" },
  title: { margin: 0, fontSize: 15, lineHeight: 22.5, fontWeight: "600" },
  note: { marginTop: 2, fontSize: 14, lineHeight: 20 },
});
