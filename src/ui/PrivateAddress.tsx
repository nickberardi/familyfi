"use client";

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PRIVATE_ADDRESS_COPY as COPY } from "@/lib/checkup";

import { Alert } from "./Alert";
import { PRESS_OPACITY, useUI } from "./UIContext";

/** Devices' notice under the Quarantine card: how many devices use a private Wi-Fi address, and a filter to them. */
export function PrivateAddressNotice({ count, showing, onShow }: { count: number; showing: boolean; onShow: () => void }) {
  return (
    <Alert
      tone="warning"
      title={COPY.notice(count)}
      action={{ label: showing ? COPY.showAll : COPY.showThem, onPress: onShow, pressed: showing, testID: "private-address-show" }}
      testID="private-address-notice"
    >
      {COPY.noticeBody}
    </Alert>
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

/**
 * A device's page, above its header: why a private Wi-Fi address matters and how to turn it off.
 * `compact`, in the device modal, folds the explanation behind a "How to fix" toggle.
 */
export function PrivateAddressCard({ compact = false }: { compact?: boolean }) {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const body = [styles.body, { fontFamily: ui.font, color: ui.color("ink-2") }];
  const strong = { fontWeight: "600" as const, color: ui.color("ink") };
  const showFix = !compact || open;
  return (
    <View style={[styles.card, compact && styles.compactCard, { backgroundColor: ui.color("card"), borderColor: ui.color("paused-line") }]} testID="private-address-card">
      <View style={styles.markLine}>
        <ui.Icon name="warning" size={compact ? 16 : 17} color={ui.color("paused")} />
        <Text style={[styles.title, compact && styles.compactTitle, { fontFamily: ui.font, color: ui.color("paused") }]}>{COPY.cardTitle}</Text>
        {compact ? (
          <Pressable
            role="button"
            aria-expanded={open}
            onPress={() => setOpen((value) => !value)}
            testID="private-address-toggle"
            style={({ pressed }) => [styles.toggle, pressed && { opacity: PRESS_OPACITY }]}
          >
            <Text style={[styles.actionLabel, { fontFamily: ui.font, color: ui.color("accent") }]}>{open ? COPY.hideFix : COPY.howToFix}</Text>
          </Pressable>
        ) : null}
      </View>
      {showFix ? (
        <>
          <Text style={[body, styles.gap]}>{COPY.cardBody}</Text>
          <Text style={[styles.label, { fontFamily: ui.font, color: ui.color("muted") }]}>{COPY.howToFix}</Text>
          <Text style={[body, styles.gap]}>
            <Text style={strong}>{COPY.iphone.label}</Text> {COPY.iphone.steps}
          </Text>
          <Text style={[body, styles.gap]}>
            <Text style={strong}>{COPY.android.label}</Text> {COPY.android.steps}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 18 },
  compactCard: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  compactTitle: { flex: 1, fontSize: 14, lineHeight: 21 },
  toggle: { flexShrink: 0 },
  title: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 20 },
  gap: { marginTop: 4 },
  label: { marginTop: 10, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  actionLabel: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  markLine: { flexDirection: "row", alignItems: "center", gap: 6 },
});
