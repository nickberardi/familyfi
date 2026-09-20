/**
 * A Phosphor Regular glyph — the product's one icon set. See `src/lib/icons.ts` for
 * why the name is a closed union and where the font is loaded.
 *
 * Always decorative: an icon sits beside the label it illustrates, never instead of
 * it, so it is `aria-hidden` with no exception.
 */

import type { IconName } from "@/lib/icons";

export function Icon({
  name,
  size = 17,
  color = "currentColor",
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <i className={`ph ph-${name}`} aria-hidden style={{ fontSize: size, color, lineHeight: 1 }} />
  );
}
