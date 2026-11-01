/**
 * Native renderers of the shared components take their light colours from `src/ui/palette.ts`;
 * the web takes them from `globals.css`. This keeps the two the same colour for every token.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DARK, LIGHT, SHADOWS } from "@/ui/palette";
import { PRESS_OPACITY } from "@/ui/UIContext";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("\n}", css.indexOf(":root")));
const declared = Object.fromEntries([...root.matchAll(/--ff-([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const resolve = (value: string, depth = 0): string => {
  const ref = /^var\(--ff-([a-z0-9-]+)\)$/.exec(value);
  return ref && depth < 5 ? resolve(declared[ref[1]!] ?? value, depth + 1) : value;
};
const colours = Object.fromEntries(
  Object.entries(declared)
    .map(([name, value]) => [name, resolve(value)] as const)
    .filter(([, value]) => /^(#|rgba?\()/.test(value)),
);

describe("shared UI palette", () => {
  it("matches globals.css for every colour token", () => {
    expect(LIGHT).toEqual(colours);
  });

  it("matches globals.css for every shadow", () => {
    const shadows = Object.fromEntries(Object.entries(declared).filter(([name]) => name.startsWith("shadow-")).map(([name, value]) => [name.slice("shadow-".length), value]));
    expect(SHADOWS).toEqual(shadows);
  });

  it("presses shared controls to the web's --ff-press-opacity", () => {
    expect(String(PRESS_OPACITY)).toBe(declared["press-opacity"]);
  });

  it("gives every verdict ink that is dark in light mode a dark value, so no category mark draws dark on the dark card", () => {
    const darkInks = Object.entries(LIGHT).filter(([name, value]) => /^verdict-.*-ink$/.test(name) && value !== "#ffffff");
    expect(darkInks.length).toBeGreaterThan(0);
    expect(darkInks.map(([name]) => name).filter((name) => !(name in DARK))).toEqual([]);
  });

  it("keeps a tile's glyph readable on its fill in both appearances", () => {
    // A category tile and a things monogram draw `ink-on-fill` on these fills; a monogram is text.
    for (const [mode, palette] of [
      ["light", LIGHT],
      ["dark", { ...LIGHT, ...DARK }],
    ] as const) {
      for (const fill of ["mark", "mono-seed-fill", "mono-user-fill"] as const) {
        const ratio = contrast(rgb(palette["ink-on-fill"]), rgb(palette[fill]));
        expect(ratio, `${mode}: ink-on-fill on ${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("has a dark value only for tokens the web declares", () => {
    expect(Object.keys(DARK).filter((name) => !(name in LIGHT))).toEqual([]);
  });
});

/** An opaque `#rrggbb` or `rgb(r, g, b)` colour's channels. */
function rgb(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
  const fn = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  throw new Error(`not an opaque colour: ${value}`);
}

/** WCAG contrast between two opaque colours. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (channels: [number, number, number]) => {
    const [r, g, b] = channels.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
