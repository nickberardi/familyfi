/**
 * The image tag, `GET /api/v1/health`, Settings and the sign-in screen all show
 * the version, and docs/operations.md requires them to agree with the OpenAPI
 * contract. They drifted once — package.json sat at 0.2.1 while the OpenAPI
 * document had already moved to 0.3.0 — so the agreement is asserted here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, appVersionLabel } from "@/lib/version";

const repoRoot = path.resolve(__dirname, "../..");

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function openapiVersion(): string {
  const text = readFileSync(path.join(repoRoot, "openapi/familyfi.v1.yaml"), "utf8");
  // info.version is the first `version:` indented under the top-level `info:`.
  const match = /^info:\n(?:[ \t]+.*\n)*?[ \t]+version:[ \t]*([0-9][^\s#]*)/m.exec(text);
  if (!match) throw new Error("Could not find info.version in openapi/familyfi.v1.yaml");
  return match[1];
}

describe("app version", () => {
  it("matches package.json", () => {
    expect(APP_VERSION).toBe(packageVersion());
    expect(appVersionLabel()).toBe(`v${packageVersion()}`);
  });

  it("matches the OpenAPI contract", () => {
    expect(openapiVersion()).toBe(APP_VERSION);
  });

  it("is a full MAJOR.MINOR.PATCH — the release workflow's Docker tags need one", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
