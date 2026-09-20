/**
 * The icon set, guarded.
 *
 * A Phosphor class that names a glyph the font does not have renders as *nothing* —
 * no box, no fallback, just a hole where a device type or a category used to be. It
 * survives typecheck, lint and review, and only a human looking at the right row ever
 * sees it. So the union in `src/lib/icons.ts` is checked against the stylesheet that
 * actually ships, and every mapping that produces a name is checked through it.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deviceIcon, deviceKindLabel } from "@/lib/display";
import type { IconName } from "@/lib/icons";
import { UPSTREAM_SEED_CATEGORIES, upstreamCategoryIcon } from "@/lib/upstream-domains";

const repoRoot = path.resolve(__dirname, "../..");

/** Glyph names Phosphor Regular declares, read from the package the app imports. */
const available = (() => {
  const stylesheet = createRequire(import.meta.url).resolve("@phosphor-icons/web/regular");
  const css = readFileSync(stylesheet, "utf8");
  return new Set([...css.matchAll(/^\.ph\.ph-([a-z0-9-]+):before/gm)].map((m) => m[1]));
})();

/** The union's members, read from source — a type cannot be enumerated at runtime. */
const declared = (() => {
  const source = readFileSync(path.join(repoRoot, "src/lib/icons.ts"), "utf8");
  const union = source.slice(source.indexOf("export type IconName ="));
  return [...union.matchAll(/^\s*\|\s*"([a-z0-9-]+)"$/gm)].map((m) => m[1] as IconName);
})();

describe("icons", () => {
  it("reads the union from source at all", () => {
    expect(declared.length).toBeGreaterThan(20);
    expect(available.size).toBeGreaterThan(500);
  });

  it.each(declared)("has %s in Phosphor Regular", (name) => {
    expect(available.has(name), `ph-${name} is not a glyph in the installed Phosphor set`).toBe(
      true,
    );
  });

  it("gives every seeded category a glyph, and invented ones none", () => {
    for (const category of UPSTREAM_SEED_CATEGORIES) {
      expect(available.has(category.icon), `${category.slug}: ph-${category.icon}`).toBe(true);
      expect(upstreamCategoryIcon(category.slug, "seed")).toBe(category.icon);
      // A household can name a category anything; there is no glyph to give it, and
      // borrowing the seed's would claim its domain list.
      expect(upstreamCategoryIcon(category.slug, "user")).toBeUndefined();
    }
    expect(upstreamCategoryIcon("knitting", "seed")).toBeUndefined();
  });

  /** Every branch of `deviceKindLabel` must land on a glyph, including its fallback. */
  it("gives every device kind a glyph", () => {
    const hostnames = [
      "Abby's iPhone",
      "Abby's iPad",
      "Nick's Watch",
      "Living Room Apple TV",
      "Nick's MacBook",
      "Echo — kitchen",
      "some-unknown-thing",
      null,
    ];
    const kinds = new Set(hostnames.map((hostname) => deviceKindLabel(hostname)));
    expect(kinds.size).toBe(7);
    for (const hostname of hostnames) {
      expect(available.has(deviceIcon(hostname)), `${hostname}: ${deviceIcon(hostname)}`).toBe(true);
    }
  });
});
