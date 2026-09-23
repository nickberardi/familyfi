/**
 * CI tested one Node version (22), the Docker image shipped another (26), and
 * `engines` promised a third (>=20.19), so a green run said nothing about the
 * runtime a household actually gets. `.node-version` is now the one answer, and
 * everything that names a Node version is asserted to agree with it. When
 * Dependabot bumps the image's `FROM` line, this fails until `.node-version`
 * moves with it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const nodeMajor = read(".node-version").trim();

describe("Node version", () => {
  it("is a bare major version in .node-version", () => {
    expect(nodeMajor).toMatch(/^\d+$/);
  });

  it("matches every node base image in the Dockerfile", () => {
    const majors = [...read("docker/Dockerfile").matchAll(/^FROM\s+node:(\d+)/gm)].map((match) => match[1]);
    expect(majors.length).toBeGreaterThan(0);
    expect(new Set(majors)).toEqual(new Set([nodeMajor]));
  });

  it("matches package.json engines and @types/node", () => {
    const pkg = JSON.parse(read("package.json")) as {
      engines: { node: string };
      devDependencies: Record<string, string>;
    };
    expect(pkg.engines.node).toBe(`>=${nodeMajor}`);
    expect(pkg.devDependencies["@types/node"]).toBe(`^${nodeMajor}`);
  });

  it("is read from .node-version by every workflow that sets up Node", () => {
    const dir = path.join(repoRoot, ".github/workflows");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".yml"))) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, `${file} hard-codes a Node version`).not.toMatch(/^\s+node-version:/m);
      const setups = text.match(/uses: actions\/setup-node@/g)?.length ?? 0;
      const fromFile = text.match(/node-version-file: \.node-version$/gm)?.length ?? 0;
      expect(fromFile, `${file}: every setup-node step reads .node-version`).toBe(setups);
    }
  });
});
