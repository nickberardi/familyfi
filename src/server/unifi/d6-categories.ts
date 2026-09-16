/**
 * D6 curated category slots — PROVISIONAL until Nick verifies on the household
 * console against GET /v1/dpi/categories. Do not treat Phase 2 as shipped with
 * these ids locked. Product candidates only; no free-text category names go in
 * UniFi policy bodies (integer ids only).
 */
export const D6_MAP_STATUS = "provisional" as const;

export type D6Slot = "video" | "social" | "gaming" | "porn";

export type D6CategoryCandidate = {
  slot: D6Slot;
  label: string;
  /** Provisional UniFi DPI category id — not Nick-confirmed. */
  provisionalCategoryId: number;
  /** Generic catalog name hint for docs/UI — not written into UniFi policy bodies. */
  provisionalCatalogName: string;
};

export const D6_CATEGORY_CANDIDATES: readonly D6CategoryCandidate[] = [
  { slot: "video", label: "Video", provisionalCategoryId: 4, provisionalCatalogName: "Media streaming" },
  { slot: "social", label: "Social", provisionalCategoryId: 24, provisionalCatalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", provisionalCategoryId: 8, provisionalCatalogName: "Online games" },
  {
    slot: "porn",
    label: "Porn",
    provisionalCategoryId: 22,
    provisionalCatalogName: "Adult",
  },
] as const;

/** Optional secondary Adult-related candidate — also provisional. */
export const D6_OPTIONAL_ADULT_TOPSITES = {
  provisionalCategoryId: 28,
  provisionalCatalogName: "TopSites-Adult",
  status: "provisional" as const,
};

export function d6ProvisionalIds(): number[] {
  return D6_CATEGORY_CANDIDATES.map((item) => item.provisionalCategoryId);
}
