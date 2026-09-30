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

  it("has a dark value only for tokens the web declares", () => {
    expect(Object.keys(DARK).filter((name) => !(name in LIGHT))).toEqual([]);
  });
});
