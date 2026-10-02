"use client";

import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { countdown, transportLabel } from "@/lib/connection-routes";
import { expiresLine } from "@/lib/pair-device";

import { PairingNameField } from "./PairingNameField";
import { QrCode } from "./QrCode";
import { PRESS_OPACITY, useUI } from "./UIContext";
import type { Pairing } from "./use-pairing";

const MONO = Platform.select({ web: "var(--font-mono)", ios: "Menlo", default: "monospace" });

function useText() {
  const ui = useUI();
  return (size: number, lineHeight: number, token: string) => ({ fontFamily: ui.font, fontSize: size, lineHeight, color: ui.color(token) });
}

/** The pairing code as text, with Copy beside it. */
function CopyRow({ label, value, copyLabel, copiedLabel }: { label: string; value: string; copyLabel: string; copiedLabel: string }) {
  const ui = useUI();
  const text = useText();
  const [copied, setCopied] = useState(false);
  return (
    <View>
      <Text style={[text(14, 21, "muted"), styles.bold]}>{label}</Text>
      <View style={styles.copyRow}>
        <Text selectable style={[text(14, 21, "ink"), styles.code, { backgroundColor: ui.color("field"), fontFamily: MONO }]} testID="pairing-code">
          {value}
        </Text>
        <Pressable
          role="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onPress={() =>
            void ui.copyText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          testID="pairing-copy"
          style={({ pressed }) => [styles.copy, { borderColor: ui.color("line") }, pressed && { opacity: PRESS_OPACITY }]}
        >
          <ui.Icon name="copy" size={16} color={ui.color("accent")} />
          <Text style={[text(14, 21, "accent"), styles.bold]}>{copied ? copiedLabel : copyLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** What the pairing sheet shows: the route and the phone's name, then the code as a QR and text, then the phone that used it. */
export function PairingBody({ pairing }: { pairing: Pairing }) {
  const ui = useUI();
  const text = useText();
  const { copy, issued } = pairing;
  const error = pairing.error ? (
    <Text role="alert" style={[text(14, 21, "danger"), styles.bold]}>
      {pairing.error}
    </Text>
  ) : null;

  if (!issued) {
    return (
      <View style={styles.stack}>
        <View>
          <Text style={[text(14, 21, "muted"), styles.bold]}>{copy.route}</Text>
          <Text style={[text(14, 21, "ink"), styles.routeLine]} testID="pairing-route">
            <Text style={{ fontFamily: MONO }}>{pairing.route.url}</Text> · {transportLabel(pairing.route.transport)}
          </Text>
          <Text style={[text(14, 21, "muted"), styles.routeLine]}>{copy.routeNote}</Text>
        </View>
        <PairingNameField label={copy.phone} value={pairing.name} onChange={pairing.setName} />
        {error}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {pairing.claimed ? (
        <Text style={[text(14, 21, "on-ink"), styles.bold, styles.claimed, { backgroundColor: ui.color("on-tint") }]} testID="pairing-claimed">
          {copy.claimedLine}
        </Text>
      ) : (
        <>
          <View style={styles.qr}>
            <QrCode value={issued.pairingCode} label={copy.qrLabel} />
            {pairing.expired ? (
              <View style={[styles.veil, { backgroundColor: ui.color("card-veil") }]}>
                <Text style={[text(17, 25.5, "ink"), styles.heavy]}>{copy.expired}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[text(14, 21, "muted"), styles.center]} testID="pairing-countdown">
            {pairing.expired ? copy.expiredLine : expiresLine(countdown(new Date(issued.expiresAt).getTime() - pairing.now))}
          </Text>
          <CopyRow label={copy.codeLabel} value={issued.pairingCode} copyLabel={copy.copy} copiedLabel={copy.copied} />
        </>
      )}
      {error}
    </View>
  );
}

function SheetButton({ label, primary, onPress, disabled, testID }: { label: string; primary?: boolean; onPress: () => void; disabled?: boolean; testID?: string }) {
  const ui = useUI();
  const text = useText();
  return (
    <Pressable
      role="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: ui.color("accent") } : { borderWidth: 1, borderColor: ui.color("line") },
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: PRESS_OPACITY },
      ]}
    >
      <Text style={[text(14, 21, primary ? "ink-on-fill" : "accent"), styles.bold]}>{label}</Text>
    </Pressable>
  );
}

/** The pairing sheet's buttons for the step it is on. */
export function PairingActions({ pairing, onClose }: { pairing: Pairing; onClose: () => void }) {
  const { copy } = pairing;
  if (!pairing.issued) {
    return (
      <>
        <SheetButton label={copy.cancel} onPress={onClose} testID="pairing-cancel" />
        <SheetButton label={copy.show} primary disabled={pairing.busy || !pairing.name.trim()} onPress={() => void pairing.generate()} testID="pairing-show" />
      </>
    );
  }
  if (pairing.claimed) return <SheetButton label={copy.done} primary onPress={onClose} testID="pairing-done" />;
  return (
    <>
      <SheetButton label={copy.cancel} onPress={onClose} testID="pairing-cancel" />
      <SheetButton label={copy.newCode} primary disabled={pairing.busy} onPress={() => void pairing.generate()} testID="pairing-new-code" />
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  bold: { fontWeight: "600" },
  heavy: { fontWeight: "700" },
  routeLine: { marginTop: 4 },
  copyRow: { marginTop: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  code: { flex: 1, minWidth: 0, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  copy: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  qr: { alignSelf: "center" },
  veil: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  claimed: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, overflow: "hidden" },
  button: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
});
