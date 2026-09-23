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
        "/api/v1/connection",
        "/api/v1/connection/devices",
        "/api/v1/connection/devices/{id}",
        "/api/v1/connection/endpoints",
        "/api/v1/connection/endpoints/{id}",
        "/api/v1/connection/identity",
        "/api/v1/connection/pairings",
        "/api/v1/connection/pairings/{id}",
        "/api/v1/connection/pairings/{id}/claim",
        "/api/v1/devices",
        "/api/v1/devices/{mac}",
        "/api/v1/devices/{mac}/assignment",
        "/api/v1/dpi/applications",
        "/api/v1/dpi/categories",
        "/api/v1/groups",
        "/api/v1/groups/{id}",
        "/api/v1/groups/{id}/extend",
        "/api/v1/groups/{id}/pause",
        "/api/v1/groups/{id}/resolver",
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
        "/api/v1/upstream/categories",
        "/api/v1/upstream/categories/{id}",
        "/api/v1/upstream/categories/{id}/check",
        "/api/v1/upstream/checks",
        "/api/v1/upstream/checks/run",
        "/api/v1/upstream/resolver",
      ].sort(),
    );
  });

  it("uses a change summary for mutations and a full change for polling", () => {
    const paths = spec.paths as Record<string, Record<string, {
      responses?: Record<string, {
        content?: { "application/json"?: { schema?: { properties?: { change?: { $ref?: string } } } } };
      }>;
    }>>;
    const changeResponses = Object.entries(paths).flatMap(([route, operations]) =>
      Object.entries(operations).flatMap(([method, operation]) =>
        Object.values(operation.responses ?? {}).flatMap((response) => {
          const reference = response.content?.["application/json"]?.schema?.properties?.change?.$ref;
          return reference ? [{ route, method, reference }] : [];
        }),
      ),
    );

    expect(changeResponses).toHaveLength(21);
    expect(changeResponses.filter(({ reference }) => reference === "#/components/schemas/ChangeSummary")).toHaveLength(20);
    expect(changeResponses.filter(({ reference }) => reference === "#/components/schemas/Change")).toEqual([
      { route: "/api/v1/changes/{id}", method: "get", reference: "#/components/schemas/Change" },
    ]);
  });
});
