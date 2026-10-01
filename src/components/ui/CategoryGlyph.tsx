/**
 * The curated category slots' marks: the shared component (`src/ui/CategoryGlyph.tsx`), which the
 * native app draws too, here in the surrounding text's colour.
 */
import { CategoryGlyph as SharedCategoryGlyph, type GlyphSlot } from "@/ui/CategoryGlyph";

export type { GlyphSlot };

export function CategoryGlyph({ slot, size = 11 }: { slot: GlyphSlot; size?: number }) {
  return <SharedCategoryGlyph slot={slot} size={size} color="currentColor" />;
}
