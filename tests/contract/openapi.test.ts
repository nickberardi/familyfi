import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CHECKUP_CHECKS } from "@/lib/checkup";

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
    // is typed as possibly absent. A field that applies to only some objects of a type is left
    // out of the others (docs/api.md); one that applies but is empty is `null`. Only fields the
    // server really omits belong here. Integration tests check every response against these schemas.
    const sometimesOmitted = [
      "Health.revision", // only when the database answered
      "Health.error", // only when degraded by configuration
      "Health.gateway", // only with ?gateway=true, for a session, while ready
      "PairedClaim.connection", // never for agents
      "PairedClaim.connection.endpoint", // only when the invite named a route
      "PairedInviteIssued.invite.url", // only for an agent
      "CheckupFinding.details.devices", // only for a check about devices
      "CheckupFinding.details.devices.wired", // only for Sonos wired and on Wi-Fi
      "CheckupFinding.details.networks", // only for a check about networks
      "CheckupFinding.details.networks.clientCount", // only for networks FamilyFi doesn't manage
      "CheckupFinding.details.networks.dnsServers", // only for a network's own DNS
      "CheckupFinding.details.wifis", // only for a check about Wi-Fi
      "CheckupFinding.details.policies", // only for leftover policies
      "CheckupFinding.details.policies.copyOf", // only for an old copy of one of FamilyFi's own
      "CheckupFinding.details.updateTag", // only for an update tag FamilyFi does not know
      "CheckupFinding.details.currentVersion", // only for a newer release on offer
      "CheckupFinding.details.latestVersion", // only for a newer release on offer
      "CheckupFinding.details.drift", // only for a rule changed in UniFi
      "CheckupFinding.details.drift.group", // only for a group's pause
      "CheckupFinding.details.drift.changes.familyfi", // every change but `other`
      "CheckupFinding.details.drift.changes.gateway", // every change but `other`
      "Rule.groupIds", // only when scope is group, never on quarantine
      "Rule.groupPauses", // only when scope is group, never on quarantine
      "Rule.networkIds", // only when scope is network
      "Rule.targetIds", // only on category and app rules
      "Rule.domains", // only on website rules other than Block countries
      "Rule.windows", // only when mode is scheduled
      "Rule.countries", // only on Block countries
      "Rule.blockPrivateRelay", // only on Lock DNS
      "Rule.openDns", // only on Lock DNS
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

  it("lists every Checkup check the server runs, as a list that may grow", () => {
    const schema = spec.components.schemas.CheckupCheck as { enum?: string[]; "x-extensible-enum"?: string[] };
    expect(schema.enum).toBeUndefined();
    expect(schema["x-extensible-enum"]).toEqual([...CHECKUP_CHECKS]);
  });
});
