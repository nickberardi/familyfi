"use client";

import { Platform, StyleSheet, Text, View } from "react-native";

import { deviceName } from "@/lib/device-assign";
import { deviceHref } from "@/lib/device-detail";
import { deviceKindLabel } from "@/lib/display";
import { GROUP_DETAIL_COPY, rulesNeedDevice } from "@/lib/group-form";
import type { Device, Group } from "@/lib/types";

import { DeviceMark } from "./DeviceMark";
import { useUI } from "./UIContext";
import { useLargeText } from "./use-large-text";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

/**
 * The group's devices as the web lists them on a phone: type, name, then kind and MAC, each row
 * opening the device. The web's wide-screen Address and Hardware columns live in its `.web.tsx`.
 */
export function GroupDevicesCard({ group, members }: { group: Group; members: Device[] }) {
  const ui = useUI();
  // At large text the heading and "Assign devices" stack, and a row's MAC takes its own line.
  const large = useLargeText();
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const accent = { fontWeight: "600" as const, color: ui.color("accent") };
  const assignHref = `/devices?assign=${group.id}`;
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("hairline-card") }]} testID="group-devices">
      <View style={[styles.head, large && styles.headStacked, { borderBottomColor: ui.color("hairline-card") }]}>
        <Text role="heading" aria-level={2} style={[text, styles.title, !large && styles.titleBeside, { color: ui.color("ink") }]}>
          {GROUP_DETAIL_COPY.devices[group.kind]}
        </Text>
        <ui.Link href={assignHref}>
          <View style={styles.touch}>
            <Text style={[text, accent]}>{GROUP_DETAIL_COPY.assignDevices}</Text>
          </View>
        </ui.Link>
      </View>
      {members.length === 0 ? (
        rulesNeedDevice(group) ? (
          // One link for the whole sentence, so it reads as one and is tall enough to touch; a link can't sit inside text here.
          <ui.Link href={assignHref}>
            <View style={[styles.empty, styles.touch]}>
              <Text style={[text, { color: ui.color("muted") }]}>
                {GROUP_DETAIL_COPY.noDevices} {GROUP_DETAIL_COPY.rulesNeedDevice.before} <Text style={accent}>{GROUP_DETAIL_COPY.rulesNeedDevice.link}</Text>
                {GROUP_DETAIL_COPY.rulesNeedDevice.after}
              </Text>
            </View>
          </ui.Link>
        ) : (
          <View style={styles.empty}>
            <Text style={[text, { color: ui.color("muted") }]}>{GROUP_DETAIL_COPY.noDevices}</Text>
          </View>
        )
      ) : (
        members.map((device, index) => (
          // The heading row draws the first hairline.
          <View key={device.mac} style={index > 0 && [styles.rowEdge, { borderTopColor: ui.color("hairline") }]}>
            <ui.Link href={deviceHref(device, group.id)} label={`View details for ${deviceName(device)}`} testID={`group-device-${device.mac}`}>
              <View style={styles.row}>
                <DeviceMark hostname={device.hostname} />
                <View style={styles.words}>
                  {/* Both lines wrap rather than cut off, so a long name and the MAC stay whole at large text. */}
                  <Text style={[text, { color: ui.color("ink") }]}>
                    {deviceName(device)}
                  </Text>
                  {large ? (
                    <>
                      <Text style={[text, { color: ui.color("muted") }]}>{deviceKindLabel(device.hostname)}</Text>
                      <Text style={[text, { color: ui.color("muted"), fontFamily: MONO }]}>{device.mac.toUpperCase()}</Text>
                    </>
                  ) : (
                    <Text style={[text, { color: ui.color("muted") }]}>
                      {deviceKindLabel(device.hostname)}
                      <Text style={{ fontFamily: MONO }}> · {device.mac.toUpperCase()}</Text>
                    </Text>
                  )}
                </View>
                <View aria-hidden>
                  <ui.Icon name="caret-right" size={14} color={ui.color("chevron")} />
                </View>
              </View>
            </ui.Link>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 4, borderBottomWidth: 1 },
  headStacked: { flexDirection: "column", alignItems: "flex-start", gap: 0, paddingTop: 12 },
  title: { fontWeight: "600" },
  titleBeside: { flex: 1 },
  empty: { paddingHorizontal: 18, paddingVertical: 16 },
  touch: { minHeight: 44, justifyContent: "center" },
  rowEdge: { borderTopWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 18, paddingVertical: 10 },
  words: { flex: 1, minWidth: 0 },
});
