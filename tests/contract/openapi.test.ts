import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

describe("openapi contract", () => {
  const spec = YAML.parse(
    readFileSync(path.join(process.cwd(), "openapi/familyfi.v1.yaml"), "utf8"),
  ) as { paths: Record<string, unknown> };

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

    // Polling a change returns the full Change; every mutation returns a ChangeSummary.
    // No counts: a new mutation route follows the rule without editing this test.
    const polling = { route: "/api/v1/changes/{id}", method: "get", reference: "#/components/schemas/Change" };
    expect(changeResponses).toContainEqual(polling);
    const mutations = changeResponses.filter(({ route, method }) => !(route === polling.route && method === polling.method));
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.filter(({ reference }) => reference !== "#/components/schemas/ChangeSummary")).toEqual([]);
  });
});
