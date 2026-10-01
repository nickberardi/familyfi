"use client";

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { networkLabel } from "@/lib/device-assign";
import { presenceSummary } from "@/lib/device-presence";
import type { Device } from "@/lib/types";

import { useUI } from "./UIContext";

/**
 * A device in a list: its name, then how it is connected, and its network when it is outside the
 * managed ones. `inline` adds to that second line and `below` adds a third, so each client chooses
 * which details fit its width (the web's wide layout moves the addresses into their own columns).
 */
export function DeviceIdentity({
  device,
  name,
  networks,
  timezone,
  now,
  inline,
  below,
}: {
  device: Device;
  name: string;
  networks: { id: string; name: string; vlanId: number }[];
  timezone: string;
  now: Date;
  inline?: ReactNode;
  below?: ReactNode;
}) {
  const ui = useUI();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  return (
    <View style={styles.identity}>
      <Text numberOfLines={1} style={[text, { color: ui.color("ink") }]}>
        {name}
      </Text>
      <Text numberOfLines={1} style={[text, styles.line, { color: ui.color("muted") }]}>
        {presenceSummary(device, timezone, now)}
        {inline}
        {!device.inScope ? ` · ${networkLabel(device, networks)}` : ""}
      </Text>
      {below}
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { minWidth: 0, flexShrink: 1 },
  line: { marginTop: 2 },
});
