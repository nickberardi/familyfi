"use client";

import { StyleSheet, View } from "react-native";

import { deviceIcon } from "@/lib/display";

import { useUI } from "./UIContext";

/**
 * The device's type, as a glyph on the well. Decorative on purpose: the device's name and type sit
 * beside it as words, so the icon is a second reading of the row rather than its only one.
 */
export function DeviceMark({ hostname, size = "row" }: { hostname: string | null; size?: "row" | "detail" }) {
  const ui = useUI();
  const detail = size === "detail";
  return (
    <View aria-hidden style={[detail ? styles.detail : styles.row, { backgroundColor: ui.color("well") }]}>
      <ui.Icon name={deviceIcon(hostname)} size={detail ? 23 : 16} color={ui.color("muted")} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: 28, height: 28, borderRadius: 7, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  detail: { width: 44, height: 44, borderRadius: 9, flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
