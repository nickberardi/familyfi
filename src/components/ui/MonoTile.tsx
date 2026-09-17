/**
 * The rounded monogram tile a category is identified by.
 *
 * Categories carry a customer-set monogram rather than a glyph, because a household
 * can invent a category and there is no icon to give it. That also keeps
 * `CategoryGlyph` out of this surface: its slot union only covers the three curated
 * DPI slots, and an unrecognised slot falls through to the game controller.
 *
 * Sibling to `Mark` rather than a variant of it — `Mark` is a circle on the
 * 44/32/24 density ladder, and these are squares at two fixed sizes from the design.
 */
export function MonoTile({
  monogram,
  source,
  size = "list",
}: {
  monogram: string;
  source: "seed" | "user";
  size?: "list" | "detail";
}) {
  const px = size === "detail" ? 40 : 32;
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center font-bold"
      style={{
        width: px,
        height: px,
        borderRadius: size === "detail" ? 10 : 9,
        background: source === "seed" ? "var(--ff-mono-seed-fill)" : "var(--ff-mono-user-fill)",
        color: "var(--ff-ink-on-fill)",
        fontSize: size === "detail" ? 12 : 10,
        letterSpacing: "-0.01em",
      }}
    >
      {monogram}
    </span>
  );
}
