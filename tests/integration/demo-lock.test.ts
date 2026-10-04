import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as createAccount } from "@/app/api/v1/accounts/route";
import { DELETE as deleteAccount, PUT as updateAccount } from "@/app/api/v1/accounts/[id]/route";
import { PUT as setPassword } from "@/app/api/v1/accounts/[id]/password/route";
import { POST as createEndpoint } from "@/app/api/v1/connection/endpoints/route";
import { DELETE as deleteEndpoint, PUT as updateEndpoint } from "@/app/api/v1/connection/endpoints/[id]/route";
import { PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as clearGroupResolver, PUT as setGroupResolver } from "@/app/api/v1/groups/[id]/resolver/route";
import { POST as pauseGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { PUT as setHousehold } from "@/app/api/v1/settings/household/route";
import { PUT as setUnifi } from "@/app/api/v1/settings/unifi/route";
import { DELETE as clearResolver, PUT as setResolver } from "@/app/api/v1/upstream/resolver/route";
import { prisma } from "@/server/db";
import { ensureDemoRoute } from "@/server/demo";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

/**
 * In demo mode every visitor shares one household, so its configuration is locked: the gateway,
 * household settings, accounts, resolvers and how phones connect. The household itself (groups,
 * rules, pauses, devices) and pairing a phone work as they do at home.
 */
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const DEMO_URL = "https://demo.familyfi.test";
const saved = { demo: process.env.FAMILYFI_DEMO, url: process.env.FAMILYFI_DEMO_URL };

async function adminAuth(): Promise<SessionAuth> {
  return authFromLogin(
    await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) })),
  );
}

function write(auth: SessionAuth, path: string, method: string, body: unknown = {}) {
  return request(path, { method, auth, headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

describe("demo mode", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.FAMILYFI_DEMO = "1";
    process.env.FAMILYFI_DEMO_URL = DEMO_URL;
    await ensureDemoRoute();
  });

  afterEach(() => {
    for (const [key, value] of [["FAMILYFI_DEMO", saved.demo], ["FAMILYFI_DEMO_URL", saved.url]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("locks every configuration write", async () => {
    const auth = await adminAuth();
    const admin = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    const route = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { url: DEMO_URL } });
    const group = (await prisma().group.create({ data: { name: "Kids", kind: "family" } })).id;
    const before = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });

    const responses = [
      await setHousehold(write(auth, "/api/v1/settings/household", "PUT", { timezone: "Europe/London" })),
      await setUnifi(write(auth, "/api/v1/settings/unifi", "PUT", { baseUrl: "https://192.0.2.1/proxy/network/integration", apiKey: "a-real-looking-key" })),
      await createAccount(write(auth, "/api/v1/accounts", "POST", { username: "visitor", displayName: "Visitor", password: "visitor-password", isAdmin: true })),
      await updateAccount(write(auth, `/api/v1/accounts/${admin.id}`, "PUT", { displayName: "Mine now" }), params({ id: admin.id })),
      await deleteAccount(write(auth, `/api/v1/accounts/${admin.id}`, "DELETE"), params({ id: admin.id })),
      await setPassword(write(auth, `/api/v1/accounts/${admin.id}/password`, "PUT", { password: "locked-out-everyone" }), params({ id: admin.id })),
      await setResolver(write(auth, "/api/v1/upstream/resolver", "PUT", { url: "https://dns.example.com/dns-query" })),
      await clearResolver(write(auth, "/api/v1/upstream/resolver", "DELETE")),
      await setGroupResolver(write(auth, `/api/v1/groups/${group}/resolver`, "PUT", { url: "https://dns.example.com/dns-query" }), params({ id: group })),
      await clearGroupResolver(write(auth, `/api/v1/groups/${group}/resolver`, "DELETE"), params({ id: group })),
      await createEndpoint(write(auth, "/api/v1/connection/endpoints", "POST", { url: "https://elsewhere.example.com", transport: "lan", trustMode: "system" })),
      await updateEndpoint(write(auth, `/api/v1/connection/endpoints/${route.id}`, "PUT", { url: "https://elsewhere.example.com" }), params({ id: route.id })),
      await deleteEndpoint(write(auth, `/api/v1/connection/endpoints/${route.id}`, "DELETE"), params({ id: route.id })),
      await setTunnel(write(auth, "/api/v1/connection/tunnel", "PUT", { mode: "quick" })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("demo_locked");
    }

    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toEqual(before);
    expect(await prisma().account.count()).toBe(1);
    expect(await prisma().connectionEndpoint.findMany()).toEqual([route]);
  });

  it("still runs the household and pairs a phone through the demo's address", async () => {
    const auth = await adminAuth();
    const created = await createGroup(write(auth, "/api/v1/groups", "POST", { name: "Kids", kind: "family", familyRole: "child" }));
    expect(created.status).toBe(201);
    const { group } = (await created.json()) as { group: { id: string } };
    const paused = await pauseGroupRule(write(auth, `/api/v1/groups/${group.id}/rules/internet/pause`, "POST"), params({ id: group.id, ruleId: "internet" }));
    expect(paused.status).toBe(200);

    const route = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { url: DEMO_URL } });
    expect(route).toMatchObject({ kind: "own", transport: "lan", trustMode: "system", edgeAuth: "none" });
    const invite = await createInvite(write(auth, "/api/v1/paired/invites", "POST", { client: "phone", endpointId: route.id, displayName: "Reviewer iPhone" }));
    expect(invite.status).toBe(201);
  });
});
