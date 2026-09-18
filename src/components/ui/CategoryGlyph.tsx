/**
 * Monochrome CSS marks for the curated category slots.
 *
 * Per the Card System: icons over letters where the shape is generic — a play
 * triangle for Video, overlapping circles for Social, a controller for Gaming,
 * a keyhole-ish shield for VPN, a speech bubble for Messaging. Named apps keep
 * short monograms instead, since a real logo would be a brand and licensing
 * problem rather than a style choice.
 *
 * Every slot returns from its own branch. The controller used to be an unguarded
 * fall-through, so an unrecognised slot silently rendered as Gaming; now an
 * unknown slot renders nothing rather than the wrong category's icon.
 *
 * Scales with the mark it sits in; `size` is the glyph's nominal width in px.
 */

import type { CuratedSlot } from "@/lib/rules";

export type GlyphSlot = CuratedSlot;

export function CategoryGlyph({ slot, size = 11 }: { slot: GlyphSlot; size?: number }) {
  if (slot === "video") {
    const h = size * 0.55;
    return (
      <span
        aria-hidden
        className="block"
        style={{
          width: 0,
          height: 0,
          marginLeft: size * 0.1,
          borderTop: `${h / 2}px solid transparent`,
          borderBottom: `${h / 2}px solid transparent`,
          borderLeft: `${size * 0.6}px solid currentColor`,
        }}
      />
    );
  }

  if (slot === "social") {
    const d = size * 0.65;
    return (
      <span aria-hidden className="relative block" style={{ width: size, height: d }}>
        <span
          className="absolute left-0 top-0 rounded-full border-[1.5px] border-current"
          style={{ width: d, height: d }}
        />
        <span
          className="absolute right-0 top-0 rounded-full border-[1.5px] border-current"
          style={{ width: d, height: d }}
        />
      </span>
    );
  }

  if (slot === "gaming") {
    const h = size * 0.65;
    const dot = size * 0.18;
    return (
      <span
        aria-hidden
        className="relative block rounded-[4px] border-[1.5px] border-current"
        style={{ width: size, height: h }}
      >
        <span
          className="absolute rounded-full bg-current"
          style={{ width: dot, height: dot, left: size * 0.18, top: h / 2 - dot / 2 - 1 }}
        />
        <span
          className="absolute rounded-full bg-current"
          style={{ width: dot, height: dot, right: size * 0.18, top: h / 2 - dot / 2 - 1 }}
        />
      </span>
    );
  }

  /* VPN — a shield: square shoulders, a point at the bottom. */
  if (slot === "vpn") {
    const w = size * 0.78;
    const h = size * 0.9;
    return (
      <span
        aria-hidden
        className="block border-[1.5px] border-current"
        style={{
          width: w,
          height: h,
          borderRadius: `${size * 0.16}px ${size * 0.16}px ${w / 2}px ${w / 2}px`,
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
      <span aria-hidden className="relative block" style={{ width: w, height: h + tail * 0.6 }}>
        <span
          className="absolute left-0 top-0 border-[1.5px] border-current"
          style={{ width: w, height: h, borderRadius: size * 0.22 }}
        />
        <span
          className="absolute bg-current"
          style={{
            width: tail,
            height: tail,
            left: size * 0.2,
            top: h - tail * 0.45,
            clipPath: "polygon(0 0, 100% 0, 0 100%)",
          }}
        />
      </span>
    );
  }

  return null;
}
