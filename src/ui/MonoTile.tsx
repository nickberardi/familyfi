"use client";

import { StyleSheet, Text, View } from "react-native";

import type { IconName } from "@/lib/icons";

import { useUI } from "./UIContext";

/**
 * The rounded tile a category is identified by. A seeded category draws its glyph; one the household
 * invented draws its monogram, because a household can name anything and there is no icon to give
 * it. Decorative: the category's label always sits beside it as text.
 */
export function MonoTile({
  monogram,
  source,
  icon,
  size = "list",
}: {
  monogram: string;
  source: "seed" | "user";
  /** The seeded category's glyph, from `upstreamCategoryIcon`. */
  icon?: IconName;
  size?: "list" | "detail";
}) {
  const ui = useUI();
  const detail = size === "detail";
  const px = detail ? 40 : 32;
  const ink = ui.color("ink-on-fill");
  return (
    <View
      aria-hidden
      style={[
        styles.tile,
        { width: px, height: px, borderRadius: detail ? 10 : 9, backgroundColor: ui.color(source === "seed" ? "mono-seed-fill" : "mono-user-fill") },
      ]}
    >
      {icon ? (
        <ui.Icon name={icon} size={detail ? 21 : 17} color={ink} />
      ) : (
        <Text style={{ fontFamily: ui.font, fontWeight: "700", fontSize: detail ? 12 : 10, lineHeight: detail ? 16 : 14, letterSpacing: -0.1, color: ink }}>{monogram}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
