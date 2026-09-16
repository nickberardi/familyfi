/**
 * Identity mark — the one component for every avatar/monogram in the app.
 *
 * Card System contract:
 *  - Kind sets the mark only. Group = rounded square, --ff-mark, radius 25% of size.
 *    Person = tinted circle.
 *  - Surface sets the density: comfortable (44) | compact (32) | dense (24). Never a fourth.
 *  - A `filter` mark is the nested rules glyph: a small accent-tinted circle.
 */

import type { ReactNode } from "react";

export type MarkDensity = "comfortable" | "compact" | "dense" | "filter";

const SIZE: Record<MarkDensity, number> = {
  comfortable: 44,
  compact: 32,
  dense: 24,
  filter: 22,
};

/** Group marks use a radius of 25% of the size, per the Card System. */
function groupRadius(size: number): number {
  return Math.round(size * 0.25);
}

/** Monograms of 3+ characters step down so "IOT" fits the same tile as "TV". */
function monogramFontSize(size: number, length: number): number {
  const base = size <= 24 ? 9 : size <= 32 ? 11 : 14;
  return length > 2 ? base - 1 : base;
}

export function Mark({
  kind,
  label,
  density = "dense",
  children,
}: {
  kind: "person" | "group" | "filter" | "network";
  /** Monogram/initial text. Ignored when `children` is supplied. */
  label?: string;
  density?: MarkDensity;
  /** A glyph to render instead of text (category shapes). */
  children?: ReactNode;
}) {
  const size = SIZE[density];

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius:
      kind === "group" ? groupRadius(size) : kind === "network" ? groupRadius(size) : "50%",
    background:
      kind === "group"
        ? "var(--ff-mark)"
        : kind === "network"
          ? "var(--ff-accent)"
          : kind === "filter"
            ? "var(--ff-accent-tint)"
            : "var(--ff-person-fill)",
    color:
      kind === "group" || kind === "network"
        ? "var(--ff-ink-on-fill)"
        : kind === "filter"
          ? "var(--ff-accent)"
          : "var(--ff-person-ink)",
    fontSize: monogramFontSize(size, (label ?? "").length),
    fontWeight: kind === "person" ? 600 : 700,
  };

  return (
    <div
      aria-hidden
      className="flex flex-none items-center justify-center leading-none"
      style={style}
    >
      {children ?? label}
    </div>
  );
}
