/**
 * D6 curated category slots — CONFIRMED for Phase 2 (Video / Social / Gaming).
 * Integer UniFi DPI category ids only in policy bodies; catalog names are for
 * UI/docs and must not be written as free-text into UniFi policies.
 * Porn / Adult is intentionally not a curated slot (may still appear in the
 * full DPI catalog for arbitrary id picks elsewhere).
 */
export const D6_MAP_STATUS = "confirmed" as const;

export type D6Slot = "video" | "social" | "gaming";

export type D6CategorySlot = {
  slot: D6Slot;
  label: string;
  /** Confirmed UniFi DPI category id for this curated slot. */
  categoryId: number;
  /** Generic catalog name hint for docs/UI — not written into UniFi policy bodies. */
  catalogName: string;
};

/** @deprecated Use D6CategorySlot — kept as alias for call sites during rename. */
export type D6CategoryCandidate = D6CategorySlot;

export const D6_CATEGORY_CANDIDATES: readonly D6CategorySlot[] = [
  { slot: "video", label: "Video", categoryId: 4, catalogName: "Media streaming services" },
  { slot: "social", label: "Social", categoryId: 24, catalogName: "Social networks" },
  { slot: "gaming", label: "Gaming", categoryId: 8, catalogName: "Online games" },
] as const;

export function d6CategoryIds(): number[] {
  return D6_CATEGORY_CANDIDATES.map((item) => item.categoryId);
}

/** @deprecated Use d6CategoryIds */
export function d6ProvisionalIds(): number[] {
  return d6CategoryIds();
}
