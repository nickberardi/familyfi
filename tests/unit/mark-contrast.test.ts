/**
 * Contrast for the category mark palette.
 *
 * AGENTS.md sets a 4.5:1 floor and nothing enforced it, so the marks shipped with
 * `--ff-on` on `--ff-on-tint` at 3.9:1 and a 9px word at 3.4:1. Both were found by
 * hand. This resolves the tokens out of globals.css and does the arithmetic, so the
 * next time someone picks a prettier green the build says no.
 *
 * Only the mark palette is in scope: those pairs are declared together in one map, so
 * they can be checked together. A repo-wide sweep would need a real CSS cascade.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categoryMarkStyle, type CategoryMarkState } from "@/lib/upstream";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

type Rgba = { r: number; g: number; b: number; a: number };

/** Resolves a `var(--ff-…)` chain down to rgba, following one token to the next. */
function token(reference: string, depth = 0): Rgba {
  expect(depth, `--ff token cycle at ${reference}`).toBeLessThan(10);
  const name = reference.match(/^var\((--ff-[a-z0-9-]+)\)$/)?.[1];
  if (!name) return literal(reference);
  const declared = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1]?.trim();
  expect(declared, `${name} is not declared in globals.css`).toBeTruthy();
  return declared!.startsWith("var(") ? token(declared!, depth + 1) : literal(declared!);
}

function literal(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const parts = value.match(/^rgba?\(([^)]+)\)$/)?.[1].split(",").map((n) => Number(n.trim()));
  expect(parts, `cannot parse colour ${value}`).toBeTruthy();
  const [r, g, b, a] = parts!;
  return { r, g, b, a: a ?? 1 };
}

/** Marks sit on a card, so that is what a translucent fill composites against. */
const CARD: Rgba = literal("#ffffff");

function flatten(colour: Rgba, under: Rgba): Rgba {
  return {
    r: colour.r * colour.a + under.r * (1 - colour.a),
    g: colour.g * colour.a + under.g * (1 - colour.a),
    b: colour.b * colour.a + under.b * (1 - colour.a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgba, background: Rgba): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe("category mark contrast", () => {
  const states: CategoryMarkState[] = ["on", "blocked", "partial", "open", "unknown"];

  it.each(states)("keeps %s's glyph readable on its own fill", (state) => {
    const { fill, ink } = categoryMarkStyle(state);
    const background = flatten(token(fill), CARD);
    const ratio = contrast(flatten(token(ink), background), background);
    // `unknown` is the resting neutral and its content is a glyph, not text; darkening
    // it further would make "we did not look" the loudest mark on the card.
    const floor = state === "unknown" ? 3 : 4.5;
    expect(ratio, `${state}: ${ink} on ${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
  });

  /** The word under a mark is 9px, which AGENTS.md forbids below 0.7 alpha. */
  it("keeps the 9px state word above the small-text alpha floor", () => {
    const ink = token("var(--ff-ink-2)");
    expect(ink.a).toBeGreaterThanOrEqual(0.7);
    expect(contrast(flatten(ink, CARD), CARD)).toBeGreaterThanOrEqual(4.5);
  });
});
