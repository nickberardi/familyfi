import { AgentGrant } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { agentRouteAllowed } from "@/server/agent-grant";

const allowed = (method: string, path: string, grant: AgentGrant | null = AgentGrant.controls) =>
  agentRouteAllowed({ method, path, grant, deviceId: "agent-1" });

describe("agentRouteAllowed", () => {
  it("lets any grant read household state and the contract", () => {
    for (const path of ["/api/v1/groups", "/api/v1/groups/g1", "/api/v1/rules", "/api/v1/devices/02:00:00:00:00:01", "/api/v1/changes/c1", "/api/v1/settings/household", "/openapi"]) {
      expect(allowed("GET", path, AgentGrant.read), path).toBe(true);
    }
  });

  it("lets only `controls` change household controls", () => {
    const writes: [string, string][] = [
      ["POST", "/api/v1/groups"],
      ["POST", "/api/v1/groups/g1/rules/internet/pause"],
      ["POST", "/api/v1/rules/r1/allow"],
      ["PATCH", "/api/v1/rules/r1"],
      ["PUT", "/api/v1/devices/02:00:00:00:00:01/assignment"],
      ["POST", "/api/v1/sync/retry"],
    ];
    for (const [method, path] of writes) {
      expect(allowed(method, path, AgentGrant.read), `${method} ${path}`).toBe(false);
      expect(allowed(method, path, null), `${method} ${path}`).toBe(false);
      expect(allowed(method, path, AgentGrant.controls), `${method} ${path}`).toBe(true);
    }
  });

  it("never reaches accounts, settings, resolvers or connection management", () => {
    const refused: [string, string][] = [
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
    for (const [method, path] of refused) expect(allowed(method, path), `${method} ${path}`).toBe(false);
  });

  it("lets an agent disconnect itself", () => {
    expect(allowed("DELETE", "/api/v1/connection/devices/agent-1", AgentGrant.read)).toBe(true);
  });

  it("does not match a longer path that starts like an allowed one", () => {
    expect(allowed("GET", "/api/v1/groups/g1/extra")).toBe(false);
    expect(allowed("POST", "/api/v1/rules/r1/pause/now")).toBe(false);
  });
});
