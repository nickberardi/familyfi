/**
 * Guards the naming rules in AGENTS.md.
 *
 * These conventions were documented before and drifted anyway — the --ff-*
 * tokens existed in globals.css while 71 raw literals sat in components. Prose
 * does not hold a convention; a failing build does.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(repoRoot, "src");

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(repoRoot, file);

/**
 * The browser resolves <meta name="theme-color"> before CSS variables exist, so
 * that one value cannot be a token. Nothing else may opt out.
 */
const COLOR_LITERAL_EXEMPT = new Set(["src/app/layout.tsx"]);

describe("naming conventions (AGENTS.md)", () => {
  it("keeps colours in --ff-* tokens, never inline literals", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot, (f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
      if (COLOR_LITERAL_EXEMPT.has(rel(file))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Ignore var(--ff-…) references; catch raw rgb/rgba/hsl/hex.
          const stripped = line.replace(/var\(--ff-[a-z0-9-]+\)/g, "");
          if (/rgba?\(\s*\d|hsla?\(\s*\d|#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/.test(stripped)) {
            offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("uses no abbreviated product prefix in identifiers", () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot, (f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // LEGACY_POLICY_PREFIX is the one sanctioned "fam-" (see AGENTS.md).
          if (line.includes("LEGACY_POLICY_PREFIX")) return;
          if (/\bFam[A-Z]|\bfam[-_][a-z]|\bfamRule/.test(line)) {
            offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("names every component file PascalCase and every module kebab-case", () => {
    const bad: string[] = [];
    for (const file of walk(srcRoot, (f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      const base = path.basename(file).replace(/\.tsx?$/, "");
      // App Router reserves these, and [id]/[mac] are route params.
      if (/^(page|layout|route|error|loading|not-found|instrumentation|middleware)$/.test(base)) continue;
      if (file.includes(`${path.sep}app${path.sep}`) && /^\[.+\]$/.test(base)) continue;

      const isComponent = file.endsWith(".tsx");
      if (isComponent && !/^[A-Z][A-Za-z0-9]*$/.test(base)) bad.push(`${rel(file)} (want PascalCase)`);
      if (!isComponent && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(base)) bad.push(`${rel(file)} (want kebab-case)`);
    }
    expect(bad).toEqual([]);
  });

  it("prefixes operator-facing environment variables with FAMILYFI_", () => {
    // Variables that configure an external system, or are framework contracts,
    // keep that system's convention — see AGENTS.md.
    const foreign =
      /^(POSTGRES_|DB_|UNIFI_|DATABASE_URL|PORT|NODE_ENV|NODE_TLS_REJECT_UNAUTHORIZED|NEXT_|CI$|HOME$|PATH$)/;
    // Ours, but development/test-only and never set on a real deployment, so
    // they are not public surface and take no prefix.
    const internal = new Set(["UNIFI_MOCK"]);
    const offenders = new Set<string>();

    for (const file of walk(srcRoot, (f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        const name = m[1];
        if (name.startsWith("FAMILYFI_") || internal.has(name) || foreign.test(name)) continue;
        offenders.add(`${rel(file)}: ${name}`);
      }
    }
    expect([...offenders]).toEqual([]);
  });

  it("declares every --ff-* token that components reference", () => {
    const css = readFileSync(path.join(srcRoot, "app/globals.css"), "utf8");
    const declared = new Set([...css.matchAll(/^\s*(--ff-[a-z0-9-]+):/gm)].map((m) => m[1]));

    const missing = new Set<string>();
    for (const file of walk(srcRoot, (f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/var\((--ff-[a-z0-9-]+)/g)) {
        if (!declared.has(m[1])) missing.add(`${rel(file)}: ${m[1]}`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
