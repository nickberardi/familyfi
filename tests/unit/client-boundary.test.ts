/**
 * "All UniFi calls are server-side. Do not put keys or UniFi clients in the browser"
 * (AGENTS.md). Nothing stopped a Client Component, or a `src/lib` module a Client
 * Component uses, from importing `src/server` — directly or through a chain of other
 * modules — and shipping it to the browser. This walks the import graph from every
 * `"use client"` file and every `src/lib` module (documented as client-safe) and fails
 * with the full chain when it reaches server code or a Node-only package.
 *
 * Next's `server-only` marker would do this at build time, but it throws in Vitest and
 * the spike CLI, which both import `src/server` outside Next's bundler.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(repoRoot, "src");
const serverRoot = path.join(srcRoot, "server") + path.sep;

/** Packages that only run on the server: the database, the HTTP agent, native hashing. */
const SERVER_PACKAGES = ["@prisma/client", "@prisma/adapter-pg", "pg", "undici", "@node-rs/argon2"];
const NODE_BUILTINS = new Set(builtinModules);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(repoRoot, file);
const isCode = (file: string) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts");

/** Value imports only: `import type` and `export type` are erased and never ship. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromClause = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(fromClause)) {
    if (!match[1]) specifiers.push(match[2]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(srcRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Why a package specifier may not reach the browser, or null when it may. */
function forbiddenPackage(specifier: string): string | null {
  if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier.split("/")[0])) return "a Node built-in";
  const found = SERVER_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  return found ? `the server-only package ${found}` : null;
}

/**
 * Every chain from a root to server code, as readable `a → b → c (reason)` lines. Roots
 * are walked in order, so a `src/lib` module reached from a Client Component reports the
 * whole path from that component.
 */
function boundaryViolations(roots: string[]): string[] {
  const parent = new Map<string, string | null>();
  const violations: string[] = [];
  const chain = (file: string): string[] => {
    const up = parent.get(file);
    return up ? [...chain(up), rel(file)] : [rel(file)];
  };
  for (const root of roots) {
    if (parent.has(root)) continue;
    parent.set(root, null);
    const queue = [root];
    while (queue.length) {
      const file = queue.shift()!;
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
          const reason = forbiddenPackage(specifier);
          if (reason) violations.push(`${chain(file).join(" → ")} → ${specifier} (${reason})`);
          continue;
        }
        const target = resolveLocal(file, specifier);
        if (!target) continue;
        if (target.startsWith(serverRoot)) {
          violations.push(`${[...chain(file), rel(target)].join(" → ")} (server code)`);
          continue;
        }
        if (!isCode(target) || parent.has(target)) continue;
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return violations;
}

const sourceFiles = walk(srcRoot).filter(isCode);
const clientFiles = sourceFiles.filter((file) => /^\s*["']use client["']/.test(readFileSync(file, "utf8")));
const libFiles = sourceFiles.filter((file) => file.startsWith(path.join(srcRoot, "lib") + path.sep));

describe("client boundary", () => {
  it("finds the files it guards", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
    expect(libFiles.length).toBeGreaterThan(0);
  });

  it("never lets a Client Component or src/lib reach server code, even through other modules", () => {
    expect(boundaryViolations([...clientFiles, ...libFiles])).toEqual([]);
  });
});
