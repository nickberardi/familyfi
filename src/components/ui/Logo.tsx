/**
 * The FamilyFi mark, in code.
 *
 * The shield and the small check shield are artwork, placed — not geometry, and never
 * re-traced by hand. Only the wordmark is live text, because it has to invert on a
 * light ground and sit on the same baseline as the rest of the rail.
 *
 * Geometry is measured off the supplied lockup, in em of the wordmark's font size: the
 * check shield is 0.503em tall and 0.411em wide with its foot 0.425em above the
 * baseline — high enough to clear the x-height, low enough to tuck against the F —
 * centred on the stem of a dotless "ı". Those ems are resolved to pixels here because
 * the wordmark's size is a number this component already has, which lets both images
 * go through `next/image` rather than shipping the full-resolution PNGs to a browser.
 *
 * The check shield is cut once per ground: its interior and the buffer band around its
 * edge are painted white or navy so the mark never traps the wrong colour where it
 * overlaps the F. Pick by the ground it sits on, not by a theme — hence `onDeep`.
 *
 * Provenance: `shield-check-light.png`, `shield-check-deep.png` and `app-icon.png` are
 * the design system's files byte for byte. `shield-family.png` is the same artwork,
 * lifted out of `app-icon.png` by clearing the navy outside the shield — the design
 * system's own cut could not be transferred whole, and the icon carries the identical
 * shield on that ground. The shield's interior is navy too, so the cut is a flood fill
 * from the edges that the white keyline stops, not a colour key. If the original cut
 * becomes available, replace the file; do not touch the geometry above.
 */

import Image from "next/image";
import shieldCheckDeep from "../../../public/brand/shield-check-deep.png";
import shieldCheckLight from "../../../public/brand/shield-check-light.png";
import shieldFamily from "../../../public/brand/shield-family.png";

/** Source aspect ratio of the shield artwork, so a height alone sizes it. */
const SHIELD_RATIO = shieldFamily.width / shieldFamily.height;

export type LogoSize = "sm" | "md" | "lg";

const SIZES: Record<LogoSize, { shield: number; word: number; tag: number; gap: number }> = {
  sm: { shield: 28, word: 15, tag: 7.5, gap: 9 },
  md: { shield: 42, word: 22, tag: 9, gap: 12 },
  lg: { shield: 104, word: 52, tag: 13, gap: 16 },
};

/**
 * The shield with the family inside — the mark itself.
 *
 * `alt` carries the product name so the lockup has exactly one accessible name; the
 * wordmark and tagline beside it are marked decorative rather than read out twice.
 */
export function Shield({ size = 28 }: { size?: number }) {
  return (
    <Image
      src={shieldFamily}
      alt="FamilyFi"
      height={size}
      width={Math.round(size * SHIELD_RATIO)}
      priority
      className="block flex-none"
    />
  );
}

/**
 * The wordmark: Family in ink, Fi in brand cyan, the check shield dotting the i.
 *
 * Decorative, like the tagline: the "i" is a dotless "\u0131" so the check shield can
 * take its place, which a screen reader would spell out as written. `Shield` stands
 * beside it carrying the real name, so the lockup is announced once and correctly.
 */
export function Wordmark({ size = 21, onDeep = false }: { size?: number; onDeep?: boolean }) {
  return (
    <div
      aria-hidden
      className="leading-none font-bold whitespace-nowrap"
      style={{
        fontFamily: "var(--ff-font-display)",
        fontSize: size,
        letterSpacing: "-0.01em",
        color: onDeep ? "var(--ff-brand-on-deep)" : "var(--ff-ink)",
      }}
    >
      Family
      <span style={{ color: "var(--ff-brand-cyan)" }}>
        F
        <span className="relative inline-block align-baseline leading-none">
          {"ı"}
          <Image
            src={onDeep ? shieldCheckDeep : shieldCheckLight}
            alt=""
            aria-hidden
            height={Math.round(size * 0.503)}
            width={Math.round(size * 0.411)}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 0.425 * size,
              transform: "translateX(-50%)",
              maxWidth: "none",
            }}
          />
        </span>
      </span>
    </div>
  );
}

/**
 * FAMILY INTERNET CONTROLS between two brand rules, as the artwork sets it.
 *
 * Decorative: at 7.5–13px this is part of the mark rather than copy, and `Shield`
 * already names the product, so a screen reader is not made to spell it a second time.
 */
export function Tagline({
  size = 10,
  onDeep = false,
  rules = true,
}: {
  size?: number;
  onDeep?: boolean;
  rules?: boolean;
}) {
  const rule = (
    <span
      className="block flex-none"
      style={{ width: "2.8em", height: "0.12em", background: "var(--ff-brand-cyan)" }}
    />
  );
  return (
    <div
      aria-hidden
      className="flex items-center font-semibold uppercase"
      style={{
        gap: "0.82em",
        fontSize: size,
        letterSpacing: "0.18em",
        whiteSpace: "nowrap",
        color: onDeep ? "var(--ff-brand-on-deep-2)" : "var(--ff-muted)",
      }}
    >
      {rules ? rule : null}
      <span>Family internet controls</span>
      {rules ? rule : null}
    </div>
  );
}

/**
 * The lockup. `stacked` is the signature — shield over wordmark over tagline, as the
 * artwork reads. `inline` is the condensed arrangement for bars wider than they are
 * tall: shield left, wordmark and tagline beside it.
 */
export function Logo({
  variant = "stacked",
  size = "md",
  tagline = true,
  onDeep = false,
}: {
  variant?: "stacked" | "inline";
  size?: LogoSize;
  tagline?: boolean;
  onDeep?: boolean;
}) {
  const s = SIZES[size];
  const stacked = variant === "stacked";
  return (
    <div
      className="flex min-w-0"
      style={{
        gap: s.gap,
        ...(stacked ? { flexDirection: "column", alignItems: "center" } : { alignItems: "center" }),
      }}
    >
      <Shield size={s.shield} />
      <div
        className="grid"
        style={{ gap: stacked ? 6 : 3, justifyItems: stacked ? "center" : "start" }}
      >
        <Wordmark size={s.word} onDeep={onDeep} />
        {tagline ? <Tagline size={s.tag} onDeep={onDeep} /> : null}
      </div>
    </div>
  );
}
