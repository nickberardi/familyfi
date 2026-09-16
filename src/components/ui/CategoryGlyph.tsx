/**
 * Monochrome CSS marks for the curated category slots.
 *
 * Per the Card System: icons over letters where the shape is generic — a play
 * triangle for Video, overlapping circles for Social, a controller for Gaming.
 * Named apps keep short monograms instead, since a real logo would be a brand
 * and licensing problem rather than a style choice.
 *
 * Scales with the mark it sits in; `size` is the glyph's nominal width in px.
 */

export type GlyphSlot = "video" | "social" | "gaming";

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
