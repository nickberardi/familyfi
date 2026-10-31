"use client";

import { Pressable, StyleSheet, Text, View } from "react-native";

import { PRIVATE_ADDRESS_COPY as COPY } from "@/lib/checkup";

import { PRESS_OPACITY, useUI } from "./UIContext";

/** Devices' notice under the Quarantine card: how many devices use a private Wi-Fi address, and a filter to them. */
export function PrivateAddressNotice({ count, showing, onShow }: { count: number; showing: boolean; onShow: () => void }) {
  const ui = useUI();
  return (
    <View style={[styles.card, styles.row, { backgroundColor: ui.color("card"), borderColor: ui.color("paused-line") }]} testID="private-address-notice">
      <View aria-hidden style={[styles.mark, { backgroundColor: ui.color("paused-fill") }]}>
        <ui.Icon name="warning" size={17} color={ui.color("paused")} />
      </View>
      <View style={styles.grow}>
        <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("ink") }]}>{COPY.notice(count)}</Text>
        <Text style={[styles.body, { fontFamily: ui.font, color: ui.color("muted") }]}>{COPY.noticeBody}</Text>
        <Pressable role="button" aria-pressed={showing} onPress={onShow} testID="private-address-show" style={({ pressed }) => [styles.action, pressed && { opacity: PRESS_OPACITY }]}>
          <Text style={[styles.actionLabel, { fontFamily: ui.font, color: ui.color("accent") }]}>{showing ? COPY.showAll : COPY.showThem}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A device row's line under its status: "⚠ Private". */
export function PrivateAddressMark() {
  const ui = useUI();
  return (
    <View role="img" aria-label={COPY.markLabel} style={styles.markLine} testID="private-address-mark">
      <ui.Icon name="warning" size={14} color={ui.color("paused")} />
      <Text style={[styles.actionLabel, { fontFamily: ui.font, color: ui.color("paused") }]}>{COPY.mark}</Text>
    </View>
  );
}

/** A device's page, above its header: why a private Wi-Fi address matters and how to turn it off. */
export function PrivateAddressCard() {
  const ui = useUI();
  const body = [styles.body, { fontFamily: ui.font, color: ui.color("ink-2") }];
  const strong = { fontWeight: "600" as const, color: ui.color("ink") };
  return (
    <View style={[styles.card, { backgroundColor: ui.color("card"), borderColor: ui.color("paused-line") }]} testID="private-address-card">
      <View style={styles.markLine}>
        <ui.Icon name="warning" size={17} color={ui.color("paused")} />
        <Text style={[styles.title, { fontFamily: ui.font, color: ui.color("paused") }]}>{COPY.cardTitle}</Text>
      </View>
      <Text style={[body, styles.gap]}>{COPY.cardBody}</Text>
      <Text style={[styles.label, { fontFamily: ui.font, color: ui.color("muted") }]}>{COPY.howToFix}</Text>
      <Text style={[body, styles.gap]}>
        <Text style={strong}>{COPY.iphone.label}</Text> {COPY.iphone.steps}
      </Text>
      <Text style={[body, styles.gap]}>
        <Text style={strong}>{COPY.android.label}</Text> {COPY.android.steps}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 18 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  mark: { marginTop: 2, width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  gap: { marginTop: 4 },
  label: { marginTop: 10, fontSize: 14, lineHeight: 20, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase" },
  action: { marginTop: 6, alignSelf: "flex-start" },
  actionLabel: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  markLine: { flexDirection: "row", alignItems: "center", gap: 6 },
});
