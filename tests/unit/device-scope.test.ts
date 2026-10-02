import { DeviceScope, PairedDeviceClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { deviceRouteAllowed, isValidScope } from "@/server/device-scope";

const { phone, watch, agent } = PairedDeviceClient;
const { full, rulesOnly, readOnly } = DeviceScope;

function allowed(client: PairedDeviceClient, scope: DeviceScope, method: string, path: string) {
  return deviceRouteAllowed({ client, scope, method, path, deviceId: "device-1" });
}

const HOUSEHOLD_WRITES: [string, string][] = [
  ["POST", "/api/v1/groups"],
  ["PATCH", "/api/v1/rules/r1"],
  ["PUT", "/api/v1/devices/02:00:00:00:00:01/assignment"],
  ["POST", "/api/v1/sync/retry"],
];
const RULE_VERBS: [string, string][] = [
  ["POST", "/api/v1/groups/g1/rules/internet/pause"],
  ["POST", "/api/v1/rules/r1/allow"],
  ["POST", "/api/v1/rules/r1/off"],
];
const NEVER_FOR_AGENTS: [string, string][] = [
  ["GET", "/api/v1/accounts"],
  ["PUT", "/api/v1/accounts/a1/password"],
  ["GET", "/api/v1/settings/unifi"],
  ["PUT", "/api/v1/settings/household"],
  ["GET", "/api/v1/groups/g1/resolver"],
  ["PUT", "/api/v1/upstream/resolver"],
  ["GET", "/api/v1/connection"],
  ["GET", "/api/v1/connection/devices"],
  ["POST", "/api/v1/connection/pairings"],
  ["PUT", "/api/v1/connection/tunnel"],
  ["DELETE", "/api/v1/connection/devices/someone-else"],
];

describe("device scopes", () => {
  it("names exactly four valid pairs", () => {
    const valid = [phone, watch, agent].flatMap((client) => [full, rulesOnly, readOnly].filter((scope) => isValidScope(client, scope)).map((scope) => `${client}:${scope}`));
    expect(valid.sort()).toEqual(["agent:full", "agent:readOnly", "phone:full", "watch:rulesOnly"]);
  });

  it("refuses everything for a pair that is not one of them", () => {
    for (const [client, scope] of [[watch, full], [agent, rulesOnly], [phone, readOnly]] as const) {
      expect(allowed(client, scope, "GET", "/api/v1/groups"), `${client}:${scope}`).toBe(false);
    }
  });

  it("phone:full allows whatever the account may", () => {
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...NEVER_FOR_AGENTS]) expect(allowed(phone, full, method, path)).toBe(true);
  });

  it("watch:rulesOnly is the Watch's list: lists, the rule verbs, its manifest, nothing else", () => {
    for (const path of ["/api/v1/auth/session", "/api/v1/connection", "/api/v1/groups", "/api/v1/rules", "/api/v1/changes/c1"]) {
      expect(allowed(watch, rulesOnly, "GET", path), path).toBe(true);
    }
    for (const [method, path] of RULE_VERBS) expect(allowed(watch, rulesOnly, method, path), path).toBe(true);
    expect(allowed(watch, rulesOnly, "DELETE", "/api/v1/connection/devices/device-1")).toBe(true);
    for (const path of ["/api/v1/groups/g1", "/api/v1/rules/r1", "/api/v1/devices", "/api/v1/settings/household", "/api/v1/sync", "/openapi"]) {
      expect(allowed(watch, rulesOnly, "GET", path), path).toBe(false);
    }
    for (const [method, path] of HOUSEHOLD_WRITES) expect(allowed(watch, rulesOnly, method, path), `${method} ${path}`).toBe(false);
  });

  it("agent:readOnly reads the household and the contract, and changes nothing", () => {
    for (const path of ["/api/v1/groups", "/api/v1/groups/g1", "/api/v1/rules/r1", "/api/v1/devices/02:00:00:00:00:01", "/api/v1/changes/c1", "/api/v1/settings/household", "/openapi"]) {
      expect(allowed(agent, readOnly, "GET", path), path).toBe(true);
    }
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...RULE_VERBS]) expect(allowed(agent, readOnly, method, path), `${method} ${path}`).toBe(false);
  });

  it("agent:full also changes household controls", () => {
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...RULE_VERBS]) expect(allowed(agent, full, method, path), `${method} ${path}`).toBe(true);
  });

  it("no agent scope reaches accounts, settings, resolvers or connection management", () => {
    for (const scope of [full, readOnly]) {
      for (const [method, path] of NEVER_FOR_AGENTS) expect(allowed(agent, scope, method, path), `${scope} ${method} ${path}`).toBe(false);
    }
  });

  it("lets an agent disconnect only itself", () => {
    expect(allowed(agent, readOnly, "DELETE", "/api/v1/connection/devices/device-1")).toBe(true);
    expect(allowed(agent, full, "DELETE", "/api/v1/connection/devices/device-2")).toBe(false);
  });

  it("does not match a longer path that starts like an allowed one", () => {
    expect(allowed(agent, full, "GET", "/api/v1/groups/g1/extra")).toBe(false);
    expect(allowed(watch, rulesOnly, "POST", "/api/v1/rules/r1/pause/now")).toBe(false);
  });
});
