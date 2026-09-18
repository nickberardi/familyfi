/**
 * Curated category slots — CONFIRMED.
 * Integer UniFi DPI category ids only in policy bodies; catalog names are for
 * UI/docs and must not be written as free-text into UniFi policies.
 * Porn / Adult is intentionally not a curated slot (may still appear in the
 * full DPI catalog for arbitrary id picks elsewhere).
 *
 * Every `catalogName` below is the console's own name for that id, verbatim.
 * Video / Social / Gaming were read off a household console (#26); VPN and
 * Messaging were added against a catalog dump of UniFi Network 10.6.106 whose
 * ids 4 / 8 / 22 / 24 / 28 reproduce this repo's already-confirmed map and the
 * `tests/fixtures/unifi/dpi-categories.page.json` names exactly. That agreement
 * on five known ids is what promotes the two new ones to confirmed.
 *
 * Messaging is category 0 alone. The catalog also carries 15 "Web instant
 * messengers", but it holds three obscure regional web clients and a slot maps
 * to one id — pick it from the app catalog if a household wants it.
 */
export const CURATED_MAP_STATUS = "confirmed" as const;

export type CuratedSlot = "video" | "social" | "gaming" | "vpn" | "messaging";

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
  { slot: "vpn", label: "VPN", categoryId: 11, catalogName: "Tunneling and proxy services" },
  // Zero is a real DPI id, so nothing downstream may test a target id for truthiness.
  { slot: "messaging", label: "Messaging", categoryId: 0, catalogName: "Instant messengers" },
] as const;

export function curatedCategoryIds(): number[] {
  return CURATED_CATEGORY_CANDIDATES.map((item) => item.categoryId);
}
