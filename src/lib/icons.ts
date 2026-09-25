/**
 * The closed set of Phosphor glyph names the product may draw.
 *
 * FamilyFi's own iconography is typographic and geometric — monograms inside `Mark`,
 * the CSS shapes in `CategoryGlyph`, chevrons — and that covers everything the product
 * invented. It does not cover the things the world already named: a phone, a printer,
 * a television, a settings gear. Those come from Phosphor Regular, imported once in
 * `src/app/layout.tsx` and served from this deployment rather than a CDN.
 *
 * A union rather than a string, because a Phosphor glyph that does not exist renders as
 * nothing at all — a silent hole in a row of devices. Add a name here and the compiler
 * says everywhere it may now be used. Every name must exist in Phosphor Regular; do not
 * mix in a second icon pack, and do not hand-draw a replacement for a glyph it has.
 *
 * It lives in `lib/` rather than beside `Icon` so modules that map data to a glyph —
 * `display.ts` for device types, `upstream-domains.ts` for seeded categories — can name
 * one without reaching into `components/`.
 */
export type IconName =
  // Navigation
  | "users-three"
  | "house-line"
  | "device-mobile"
  | "list-checks"
  | "squares-four"
  | "arrows-clockwise"
  | "gear"
  | "code"
  | "qr-code"
  // Actions
  | "copy"
  | "arrow-square-out"
  // Device types
  | "device-tablet"
  | "laptop"
  | "desktop-tower"
  | "monitor"
  | "television"
  | "speaker-high"
  | "watch"
  | "printer"
  | "game-controller"
  | "wifi-high"
  | "network"
  | "question"
  // Upstream categories
  | "prohibit"
  | "play-circle"
  | "shield-check"
  | "chat-circle"
  | "sparkle"
  | "poker-chip"
  | "heart";
