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
        "/api/v1/accounts",
        "/api/v1/accounts/{id}",
        "/api/v1/accounts/{id}/password",
        "/api/v1/auth/login",
        "/api/v1/auth/logout",
        "/api/v1/auth/session",
        "/api/v1/changes/{id}",
        "/api/v1/devices",
        "/api/v1/devices/{mac}",
        "/api/v1/devices/{mac}/assignment",
        "/api/v1/dpi/applications",
        "/api/v1/dpi/categories",
        "/api/v1/groups",
        "/api/v1/groups/{id}",
        "/api/v1/groups/{id}/extend",
        "/api/v1/groups/{id}/pause",
        "/api/v1/groups/{id}/resume",
        "/api/v1/groups/{id}/schedule",
        "/api/v1/health",
        "/api/v1/rules",
        "/api/v1/rules/{id}",
        "/api/v1/rules/{id}/off",
        "/api/v1/settings/household",
        "/api/v1/settings/unifi",
        "/api/v1/settings/unifi/test",
        "/api/v1/sync",
        "/api/v1/sync/retry",
      ].sort(),
    );
  });
});
