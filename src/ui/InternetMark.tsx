"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { MARK_WIDTH } from "@/lib/category-marks";
import { internetMarkLook } from "@/lib/internet-zone";
import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** All internet as one mark in a closed card's row, shared by every client: Off, Paused, On or No rule. */
export function InternetMark({
  group,
  windows,
  timezone,
  now,
  onPress,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  onPress: () => void;
}) {
  const ui = useUI();
  const look = internetMarkLook(group, windows, timezone, now);
  return (
    <Pressable role="button" aria-label={`All internet — ${look.word.toLowerCase()}`} onPress={onPress} style={({ pressed }) => [styles.mark, pressed && { opacity: PRESS_OPACITY }]}>
      <View
        style={[
          styles.tile,
          look.fill ? { backgroundColor: ui.color(look.fill) } : null,
          look.border === "dashed" ? { borderWidth: 1.5, borderStyle: "dashed", borderColor: ui.color("control-line") } : null,
        ]}
      >
        <View aria-hidden>
          <ui.Icon name="globe-simple" size={18} color={ui.color(look.ink)} />
        </View>
      </View>
      <Text style={{ fontFamily: ui.font, fontSize: 10, lineHeight: 15, color: ui.color("ink-2") }}>Internet</Text>
      <Text style={{ fontFamily: ui.font, fontSize: 9, lineHeight: 13.5, fontWeight: "600", color: ui.color(look.wordInk) }}>{look.word}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: { width: MARK_WIDTH, alignItems: "center", gap: 4 },
  tile: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
});
