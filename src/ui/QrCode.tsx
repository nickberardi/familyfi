"use client";

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { encode } from "uqr";

import { useUI } from "./UIContext";

/**
 * A QR code drawn from its module matrix, as the web draws it: error correction M, a four-module
 * quiet zone, and the `qr-ground` and `qr-ink` tokens. Each row's runs of dark modules are one
 * view, so a pairing code's QR stays a few hundred views.
 */
export function QrCode({ value, size = 280, label }: { value: string; size?: number; label: string }) {
  const ui = useUI();
  const { data, size: modules } = useMemo(() => encode(value, { ecc: "M", border: 4 }), [value]);
  const runs = useMemo(() => {
    const out: { y: number; x: number; length: number }[] = [];
    data.forEach((row, y) => {
      let start = -1;
      row.forEach((dark, x) => {
        if (dark && start < 0) start = x;
        if ((!dark || x === row.length - 1) && start >= 0) {
          out.push({ y, x: start, length: (dark ? x + 1 : x) - start });
          start = -1;
        }
      });
    });
    return out;
  }, [data]);
  // Whole-pixel modules, so no seam shows between rows; the code is at most `size` across.
  const cell = Math.max(1, Math.floor(size / modules));
  const ink = ui.color("qr-ink");
  return (
    <View role="img" aria-label={label} style={{ width: cell * modules, height: cell * modules, backgroundColor: ui.color("qr-ground") }} testID="pairing-qr">
      {runs.map((run) => (
        <View
          key={`${run.y}-${run.x}`}
          style={[styles.run, { top: run.y * cell, left: run.x * cell, width: run.length * cell, height: cell, backgroundColor: ink }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ run: { position: "absolute" } });
