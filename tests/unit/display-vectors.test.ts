/**
 * `tests/fixtures/display-vectors.json` is the display behaviour the web app and the
 * native iOS app (nickberardi/familyfi-ios, `App/Display/*`) must both show: labels,
 * states, card actions, the pause sheet, and rule windows with the internet state and
 * day timeline built from them. iOS replays the same file against its port,
 * so this test runs every vector against the TypeScript and fails when either drifts.
 * Change display behaviour and the vectors change in the same pull request.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXCLUDED, MODULES, RUNNERS, type VectorFile } from "@/lib/display-vectors";

const file = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/display-vectors.json"), "utf8")) as VectorFile;

describe("display vectors", () => {
  it("is version 1 with unique names per function", () => {
    expect(file.version).toBe(1);
    const keys = file.vectors.map((vector) => `${vector.fn} / ${vector.name}`);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  it("covers every exported function, or says why not", () => {
    const exported = Object.values(MODULES).flatMap((module) =>
      Object.entries(module)
        .filter(([, value]) => typeof value === "function")
        .map(([name]) => name),
    );
    const covered = new Set(file.vectors.map((vector) => vector.fn));
    expect(exported.filter((name) => !covered.has(name) && !(name in EXCLUDED))).toEqual([]);
    expect(Object.keys(EXCLUDED).filter((name) => !exported.includes(name))).toEqual([]);
    expect(Object.keys(RUNNERS).filter((name) => !exported.includes(name))).toEqual([]);
  });

  it.each(file.vectors.map((vector) => [`${vector.fn} / ${vector.name}`, vector] as const))("%s", (_, vector) => {
    const run = RUNNERS[vector.fn];
    expect(run, `no runner for ${vector.fn}`).toBeDefined();
    // A JSON round trip drops undefined fields, as the fixture and any other reader see them.
    expect(JSON.parse(JSON.stringify(run!(vector.input)))).toEqual(vector.expected);
  });
});
