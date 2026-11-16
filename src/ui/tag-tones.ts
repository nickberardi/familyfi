import type { TagTone } from "@/lib/pair-device";

/**
 * Each tone's ink and fill: grey, then the system's own state tints (the success, warning, danger
 * and info Alert's) and a yellow for a choice left off, never the verdict palette. Each ink holds
 * 4.5:1 on its fill; no yellow ink does on a light ground, so yellow writes in the page's ink.
 */
export const TAG_TONES: Record<TagTone, { ink: string; fill: string }> = {
  neutral: { ink: "ink-2", fill: "field" },
  green: { ink: "on-ink", fill: "on-tint" },
  yellow: { ink: "ink", fill: "caution-fill" },
  red: { ink: "danger", fill: "danger-tint" },
  blue: { ink: "accent", fill: "accent-fill" },
};
