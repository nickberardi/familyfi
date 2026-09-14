import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

describe("openapi contract", () => {
  const spec = YAML.parse(
    readFileSync(path.join(process.cwd(), "openapi/familyfi.v1.yaml"), "utf8"),
  ) as { paths: Record<string, unknown> };

  it("documents every implemented v1 route", () => {
    expect(Object.keys(spec.paths).sort()).toEqual(
      [
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/api/v1/auth/session",
        "/api/v1/health",
      ].sort(),
    );
  });
});
