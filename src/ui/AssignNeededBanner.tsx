"use client";

import { StyleSheet, Text, View } from "react-native";

import { assignDevicesCopy } from "@/lib/device-assign";
import type { Group } from "@/lib/types";

import { useUI } from "./UIContext";

/** A group with no devices, sent to the Devices list to get one: why it needs one. */
export function AssignNeededBanner({ group }: { group: Pick<Group, "name"> }) {
  const ui = useUI();
  const copy = assignDevicesCopy(group);
  const text = { fontFamily: ui.font, fontSize: 14 };
  return (
    <View style={[styles.banner, { backgroundColor: ui.color("paused-fill"), borderColor: ui.color("paused-line") }]} testID="assign-needed">
      <Text style={[text, styles.title, { color: ui.color("paused") }]}>{copy.needsTitle}</Text>
      <Text style={[text, styles.body, { color: ui.color("muted") }]}>{copy.needsBody}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 12 },
  title: { fontWeight: "600", lineHeight: 21 },
  body: { marginTop: 2, lineHeight: 20 },
});
