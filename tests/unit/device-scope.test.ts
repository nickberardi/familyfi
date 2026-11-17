import { describe, expect, it } from "vitest";
import { CLIENT_TYPES, DEVICE_SCOPES } from "@/lib/client-type";
import { deviceRouteAllowed, isFullApp, isValidScope } from "@/server/device-scope";

function allowed(clientType: string, scope: string, method: string, path: string) {
  return deviceRouteAllowed({ clientType, scope, method, path, deviceId: "device-1" });
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
  ["GET", "/api/v1/paired/devices"],
  ["POST", "/api/v1/paired/invites"],
  ["PATCH", "/api/v1/paired/devices/someone-else"],
  ["PUT", "/api/v1/connection/tunnel"],
  ["DELETE", "/api/v1/paired/devices/someone-else"],
  ["PUT", "/api/v1/paired/devices/device-1/push"],
  ["DELETE", "/api/v1/paired/devices/device-1/push"],
  ["GET", "/api/v1/paired/devices/device-1/alerts"],
  ["PUT", "/api/v1/paired/devices/device-1/alerts"],
];

describe("device scopes", () => {
  it("lets each client type hold only its own scopes", () => {
    const valid = CLIENT_TYPES.flatMap((clientType) => DEVICE_SCOPES.filter((scope) => isValidScope(clientType, scope)).map((scope) => `${clientType} ${scope}`));
    expect(valid.sort()).toEqual(["agent agent:full", "agent agent:readOnly", "app app:full", "app-controls app:rulesOnly", "app-watch app:rulesOnly", "me me:askOnly"]);
  });

  it("refuses everything for a scope its client type may not hold, or one it does not know", () => {
    for (const [clientType, scope] of [["app-watch", "app:full"], ["agent", "app:rulesOnly"], ["app", "agent:readOnly"], ["app-controls", "app:full"], ["app", "full"], ["watch", "app:rulesOnly"], ["me", "app:full"]] as const) {
      expect(allowed(clientType, scope, "GET", "/api/v1/groups"), `${clientType} ${scope}`).toBe(false);
    }
  });

  it("me:askOnly allows nothing until FamilyFi Me's routes come", () => {
    for (const [method, path] of [["GET", "/api/v1/auth/session"], ["GET", "/api/v1/groups"], ...RULE_VERBS]) expect(allowed("me", "me:askOnly", method, path), `${method} ${path}`).toBe(false);
  });

  it("app:full allows whatever the account may", () => {
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...NEVER_FOR_AGENTS]) expect(allowed("app", "app:full", method, path)).toBe(true);
  });

  it("watch:rulesOnly is the Watch's list: lists, the rule verbs, its manifest, nothing else", () => {
    for (const path of ["/api/v1/auth/session", "/api/v1/connection", "/api/v1/groups", "/api/v1/rules", "/api/v1/changes/c1"]) {
      expect(allowed("app-watch", "app:rulesOnly", "GET", path), path).toBe(true);
    }
    for (const [method, path] of RULE_VERBS) expect(allowed("app-watch", "app:rulesOnly", method, path), path).toBe(true);
    expect(allowed("app-watch", "app:rulesOnly", "DELETE", "/api/v1/paired/devices/device-1")).toBe(true);
    for (const path of ["/api/v1/groups/g1", "/api/v1/rules/r1", "/api/v1/devices", "/api/v1/settings/household", "/api/v1/sync", "/openapi"]) {
      expect(allowed("app-watch", "app:rulesOnly", "GET", path), path).toBe(false);
    }
    for (const [method, path] of HOUSEHOLD_WRITES) expect(allowed("app-watch", "app:rulesOnly", method, path), `${method} ${path}`).toBe(false);
  });

  it("app:rulesOnly is the Watch's list, call for call, and nothing more of app:full's", () => {
    const calls: [string, string][] = [
      ...["/api/v1/auth/session", "/api/v1/connection", "/api/v1/groups", "/api/v1/rules", "/api/v1/changes/c1", "/api/v1/groups/g1", "/api/v1/devices", "/api/v1/paired/devices"].map((path): [string, string] => ["GET", path]),
      ...RULE_VERBS,
      ...HOUSEHOLD_WRITES,
      ...NEVER_FOR_AGENTS,
      ["DELETE", "/api/v1/paired/devices/device-1"],
      ["POST", "/api/v1/rules/quarantine/off"],
    ];
    for (const [method, path] of calls) {
      expect(allowed("app-controls", "app:rulesOnly", method, path), `${method} ${path}`).toBe(allowed("app-watch", "app:rulesOnly", method, path));
    }
    expect(allowed("app-controls", "app:rulesOnly", "POST", "/api/v1/groups/g1/unblock")).toBe(true);
    expect(allowed("app-controls", "app:rulesOnly", "POST", "/api/v1/paired/invites")).toBe(false);
  });

  it("counts only app:full as the app itself, never the client alone", () => {
    expect(isFullApp({ clientType: "app", scope: "app:full" })).toBe(true);
    expect(isFullApp({ clientType: "app-controls", scope: "app:rulesOnly" })).toBe(false);
    expect(isFullApp({ clientType: "app-watch", scope: "app:rulesOnly" })).toBe(false);
    expect(isFullApp({ clientType: "agent", scope: "agent:full" })).toBe(false);
    expect(isFullApp(null)).toBe(false);
  });

  it("agent:readOnly reads the household and the contract, and changes nothing", () => {
    for (const path of ["/api/v1/groups", "/api/v1/groups/g1", "/api/v1/rules/r1", "/api/v1/devices/02:00:00:00:00:01", "/api/v1/changes/c1", "/api/v1/settings/household", "/openapi"]) {
      expect(allowed("agent", "agent:readOnly", "GET", path), path).toBe(true);
    }
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...RULE_VERBS]) expect(allowed("agent", "agent:readOnly", method, path), `${method} ${path}`).toBe(false);
  });

  it("agent:full also changes household controls", () => {
    for (const [method, path] of [...HOUSEHOLD_WRITES, ...RULE_VERBS]) expect(allowed("agent", "agent:full", method, path), `${method} ${path}`).toBe(true);
  });

  it("no agent scope reaches accounts, settings, resolvers or connection management", () => {
    for (const scope of ["agent:full", "agent:readOnly"]) {
      for (const [method, path] of NEVER_FOR_AGENTS) expect(allowed("agent", scope, method, path), `${scope} ${method} ${path}`).toBe(false);
    }
  });

  it("lets a Watch or an agent pause quarantine, never switch, edit or delete it", () => {
    const lifts: [string, string][] = [["POST", "/api/v1/rules/quarantine/pause"], ["POST", "/api/v1/rules/quarantine/extend"], ["POST", "/api/v1/rules/quarantine/resume"]];
    const switches: [string, string][] = [
      ["POST", "/api/v1/rules/quarantine/on"],
      ["POST", "/api/v1/rules/quarantine/off"],
      ["PATCH", "/api/v1/rules/quarantine"],
      ["DELETE", "/api/v1/rules/quarantine"],
    ];
    for (const [client, scope] of [["app-watch", "app:rulesOnly"], ["agent", "agent:full"]] as const) {
      for (const [method, path] of lifts) expect(allowed(client, scope, method, path), `${client} ${method} ${path}`).toBe(true);
      for (const [method, path] of switches) expect(allowed(client, scope, method, path), `${client} ${method} ${path}`).toBe(false);
    }
    expect(allowed("agent", "agent:readOnly", "GET", "/api/v1/rules/quarantine")).toBe(true);
    for (const [method, path] of switches) expect(allowed("app", "app:full", method, path), `app ${method} ${path}`).toBe(true);
  });

  it("lets an agent disconnect only itself", () => {
    expect(allowed("agent", "agent:readOnly", "DELETE", "/api/v1/paired/devices/device-1")).toBe(true);
    expect(allowed("agent", "agent:full", "DELETE", "/api/v1/paired/devices/device-2")).toBe(false);
  });

  it("does not match a longer path that starts like an allowed one", () => {
    expect(allowed("agent", "agent:full", "GET", "/api/v1/groups/g1/extra")).toBe(false);
    expect(allowed("app-watch", "app:rulesOnly", "POST", "/api/v1/rules/r1/pause/now")).toBe(false);
  });
});
