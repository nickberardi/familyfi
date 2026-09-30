/**
 * The FamilyFi lockup's geometry, shared by the web's and the native app's `Logo` (`src/ui`).
 * Measured off the supplied artwork in em of the wordmark's font size: the check shield that dots
 * the "ı" is 0.503em tall and 0.411em wide, its foot 0.425em above the baseline.
 */
export type LogoSize = "sm" | "md" | "lg";

export const LOGO_SIZES: Record<LogoSize, { shield: number; word: number; tag: number; gap: number }> = {
  sm: { shield: 28, word: 15, tag: 7.5, gap: 9 },
  md: { shield: 42, word: 22, tag: 9, gap: 12 },
  lg: { shield: 104, word: 52, tag: 13, gap: 16 },
};

/** `shield-family.png` is 308 × 396, so a height alone sizes it. */
export const SHIELD_RATIO = 308 / 396;

export const CHECK_SHIELD = { height: 0.503, width: 0.411, foot: 0.425 } as const;

export const TAGLINE = "Family internet controls";
