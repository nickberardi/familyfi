/**
 * Monochrome marks for the curated category slots, drawn from borders so every client draws them
 * the same.
 *
 * Per the Card System: icons over letters where the shape is generic — a play triangle for Video,
 * overlapping circles for Social, a controller for Gaming, a keyhole-ish shield for VPN, a speech
 * bubble for Messaging. Named apps keep short monograms instead, since a real logo would be a
 * brand and licensing problem rather than a style choice.
 *
 * Every slot returns from its own branch, so an unknown slot renders nothing rather than the wrong
 * category's icon. Scales with the mark it sits in; `size` is the glyph's nominal width in px, and
 * `color` its ink.
 */
import { View } from "react-native";

import type { CuratedSlot } from "@/lib/rules";

export type GlyphSlot = CuratedSlot;

const LINE = 1.5;

export function CategoryGlyph({ slot, size = 11, color }: { slot: GlyphSlot; size?: number; color: string }) {
  if (slot === "video") {
    const h = size * 0.55;
    return (
      <View
        aria-hidden
        style={{
          width: 0,
          height: 0,
          marginLeft: size * 0.1,
          borderTopWidth: h / 2,
          borderBottomWidth: h / 2,
          borderLeftWidth: size * 0.6,
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: color,
        }}
      />
    );
  }

  if (slot === "social") {
    const d = size * 0.65;
    const ring = { position: "absolute" as const, top: 0, width: d, height: d, borderRadius: d / 2, borderWidth: LINE, borderColor: color };
    return (
      <View aria-hidden style={{ width: size, height: d }}>
        <View style={[ring, { left: 0 }]} />
        <View style={[ring, { right: 0 }]} />
      </View>
    );
  }

  if (slot === "gaming") {
    const h = size * 0.65;
    const dot = size * 0.18;
    const button = { position: "absolute" as const, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, top: (h - LINE * 2) / 2 - dot / 2 - 1 };
    return (
      <View aria-hidden style={{ width: size, height: h, borderRadius: 4, borderWidth: LINE, borderColor: color }}>
        <View style={[button, { left: size * 0.18 - LINE }]} />
        <View style={[button, { right: size * 0.18 - LINE }]} />
      </View>
    );
  }

  /* VPN — a shield: square shoulders, a point at the bottom. */
  if (slot === "vpn") {
    const w = size * 0.78;
    const h = size * 0.9;
    return (
      <View
        aria-hidden
        style={{
          width: w,
          height: h,
          borderWidth: LINE,
          borderColor: color,
          borderTopLeftRadius: size * 0.16,
          borderTopRightRadius: size * 0.16,
          borderBottomLeftRadius: w / 2,
          borderBottomRightRadius: w / 2,
        }}
      />
    );
  }

  /* Messaging — a speech bubble: rounded box with a tail off the bottom-left. */
  if (slot === "messaging") {
    const w = size * 0.92;
    const h = size * 0.68;
    const tail = size * 0.22;
    return (
      <View aria-hidden style={{ width: w, height: h + tail * 0.6 }}>
        <View style={{ position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: size * 0.22, borderWidth: LINE, borderColor: color }} />
        {/* The tail: a right triangle, its square corner top-left. */}
        <View
          style={{
            position: "absolute",
            left: size * 0.2,
            top: h - tail * 0.45,
            width: 0,
            height: 0,
            borderTopWidth: tail,
            borderRightWidth: tail,
            borderTopColor: color,
            borderRightColor: "transparent",
          }}
        />
      </View>
    );
  }

  return null;
}
