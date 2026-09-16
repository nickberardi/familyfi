/**
 * Curated category slots — CONFIRMED (Video / Social / Gaming).
 * Integer UniFi DPI category ids only in policy bodies; catalog names are for
 * UI/docs and must not be written as free-text into UniFi policies.
 * Porn / Adult is intentionally not a curated slot (may still appear in the
 * full DPI catalog for arbitrary id picks elsewhere).
 */
export const CURATED_MAP_STATUS = "confirmed" as const;

export type CuratedSlot = "video" | "social" | "gaming";

export type CuratedCategorySlot = {
  slot: CuratedSlot;
  label: string;
  /** Confirmed UniFi DPI category id for this curated slot. */
  categoryId: number;
  /** Generic catalog name hint for docs/UI — not written into UniFi policy bodies. */
  catalogName: string;
};

export const CURATED_CATEGORY_CANDIDATES: readonly CuratedCategorySlot[] = [
  { slot: "video", label: "Video", categoryId: 4, catalogName: "Media streaming services" },
  { slot: "social", label: "Social", categoryId: 24, catalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", categoryId: 8, catalogName: "Online games" },
] as const;

export function curatedCategoryIds(): number[] {
  return CURATED_CATEGORY_CANDIDATES.map((item) => item.categoryId);
}
