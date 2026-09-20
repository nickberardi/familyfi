/**
 * The rounded tile a category is identified by.
 *
 * A seeded category draws a Phosphor glyph; one the household invented draws its
 * monogram, because a household can name anything and there is no icon to give it.
 * Every category stores a monogram regardless — it is the category's short name in the
 * API and in the seed, and the only thing an invented one has to draw with.
 * `CategoryGlyph` stays out of this surface: its slot union only covers the curated
 * DPI slots, and an unrecognised slot renders nothing.
 *
 * Sibling to `Mark` rather than a variant of it — `Mark` is a circle on the
 * 44/32/24 density ladder, and these are squares at two fixed sizes from the design.
 *
 * Decorative: the category's label always sits beside it as text.
 */

import { Icon } from "./Icon";
import type { IconName } from "@/lib/icons";

export function MonoTile({
  monogram,
  source,
  icon,
  size = "list",
}: {
  monogram: string;
  source: "seed" | "user";
  /** The seeded category's glyph, from `upstreamCategoryIcon`. */
  icon?: IconName;
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
      {icon ? <Icon name={icon} size={size === "detail" ? 21 : 17} /> : monogram}
    </span>
  );
}
