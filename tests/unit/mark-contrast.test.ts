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
  const states: CategoryMarkState[] = ["rule", "blocked", "partial", "open", "unknown"];

  it.each(states)("keeps %s's glyph readable on its own fill", (state) => {
    const { fill, ink } = categoryMarkStyle(state);
    const background = flatten(token(fill), CARD);
    const ratio = contrast(flatten(token(ink), background), background);
    // `unknown` used to be allowed 3:1 as a quiet glyph, but its ink also sets the state
    // word in text pills, so it meets the same floor as every other verdict.
    expect(ratio, `${state}: ${ink} on ${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  /** The word under a mark is 9px, which AGENTS.md forbids below 0.7 alpha. */
  it("keeps the 9px state word above the small-text alpha floor", () => {
    const ink = token("var(--ff-ink-2)");
    expect(ink.a).toBeGreaterThanOrEqual(0.7);
    expect(contrast(flatten(ink, CARD), CARD)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * The accent is the only interactive colour, and the green reads "on" across the app, so
 * both appear as text and as fills on every page. The browser suite checks rendered pages
 * with axe; this catches a token change before anything renders.
 */
describe("interactive and status colours", () => {
  const PAGE = token("var(--ff-page)");
  const WHITE = literal("#ffffff");

  it.each([
    ["white text on an accent button", WHITE, "var(--ff-accent)", CARD],
    ["white text on the hovered accent", WHITE, "var(--ff-accent-hover)", CARD],
    ["accent text on a card", "var(--ff-accent)", "var(--ff-card)", CARD],
    ["accent text on the page", "var(--ff-accent)", "var(--ff-page)", PAGE],
    ["accent text on its own tint", "var(--ff-accent)", "var(--ff-accent-tint)", CARD],
    ["on-green text on a card", "var(--ff-on)", "var(--ff-card)", CARD],
    ["on-green text on the page", "var(--ff-on)", "var(--ff-page)", PAGE],
    ["a person monogram on its fill", "var(--ff-person-ink)", "var(--ff-person-fill)", CARD],
    ...(["--ff-ink-2", "--ff-ink-3", "--ff-ink-4", "--ff-locked"] as const).flatMap((ink) => [
      [`${ink} on a card`, `var(${ink})`, "var(--ff-card)", CARD] as const,
      [`${ink} on the page`, `var(${ink})`, "var(--ff-page)", PAGE] as const,
      [`${ink} on a grey control`, `var(${ink})`, "var(--ff-field)", CARD] as const,
    ]),
  ] as const)("keeps %s at 4.5:1", (label, ink, fill, under) => {
    const foreground = typeof ink === "string" ? token(ink) : ink;
    const background = flatten(token(fill), under);
    const ratio = contrast(flatten(foreground, background), background);
    expect(ratio, `${label} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

