import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

describe("openapi contract", () => {
  const spec = YAML.parse(
    readFileSync(path.join(process.cwd(), "openapi/familyfi.v1.yaml"), "utf8"),
  ) as { paths: Record<string, unknown>; components: Record<string, Record<string, unknown>> };

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

  it("marks every response field required unless the server sometimes leaves it out", () => {
    // Clients are generated from this document (familyfi#124): a field missing from `required`
    // is typed as possibly absent. The server sends an empty value as `null`, so only fields
    // it really omits belong here. Integration tests check every response against these schemas.
    const sometimesOmitted = [
      "Health.revision", // only when the database answered
      "Health.error", // only when degraded by configuration
      "PairedClaim.connection", // never for agents
      "PairedClaim.connection.endpoint", // only when the invite named a route
    ];
    type Schema = Record<string, unknown> & {
      $ref?: string;
      properties?: Record<string, Schema>;
      required?: string[];
      items?: Schema;
      allOf?: Schema[];
      oneOf?: Schema[];
      anyOf?: Schema[];
    };
    const resolve = (ref: string) =>
      ref.replace(/^#\//, "").split("/").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], spec) as Schema;

    const optional = new Set<string>();
    const seen = new Set<string>();
    const walk = (schema: Schema | undefined, at: string) => {
      if (!schema || typeof schema !== "object") return;
      if (schema.$ref) {
        if (seen.has(schema.$ref)) return;
        seen.add(schema.$ref);
        const name = schema.$ref.replace(/^#\/components\/schemas\//, "").replace(/\/properties\//g, ".");
        return walk(resolve(schema.$ref), name);
      }
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        if (!schema.required?.includes(key)) optional.add(`${at}.${key}`);
        walk(property, `${at}.${key}`);
      }
      walk(schema.items, at);
      for (const branch of [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) walk(branch, at);
    };

    const paths = spec.paths as Record<string, Record<string, { responses?: Record<string, Schema> }>>;
    for (const [route, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const resolved = (response.$ref ? resolve(response.$ref) : response) as {
            content?: Record<string, { schema?: Schema }>;
          };
          for (const content of Object.values(resolved.content ?? {})) {
            walk(content.schema, `${method.toUpperCase()} ${route} ${status}`);
          }
        }
      }
    }

    expect([...optional].sort()).toEqual([...sometimesOmitted].sort());
  });
});
