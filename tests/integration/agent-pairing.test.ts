import { beforeEach, describe, expect, it } from "vitest";
import { AccountKind, DeviceScope, PairedDeviceClient } from "@prisma/client";
import { TUNNEL_HEADER } from "@/lib/constants";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as agentGuide } from "@/app/agents.md/route";
import { GET as openapi } from "@/app/openapi/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { GET as listAccounts } from "@/app/api/v1/accounts/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { GET as getHome, PUT as setHome } from "@/app/api/v1/connection/home/route";
import { GET as listDevices } from "@/app/api/v1/paired/devices/route";
import { DELETE as revokeDevice } from "@/app/api/v1/paired/devices/[id]/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { GET as inviteStatus } from "@/app/api/v1/paired/invites/[id]/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { inviteAgent } from "@/server/pairing";
import { withAdmin } from "@/server/guard";
import { GET as listGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { GET as settingsUnifi } from "@/app/api/v1/settings/unifi/route";
import { GET as household } from "@/app/api/v1/settings/household/route";
import { POST as pauseGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { claimInvite, issuedInvite } from "../helpers/pairing";
import { TEST_ORIGIN } from "../helpers/test-env";

const json = { "content-type": "application/json" };

function bearer(token: string): SessionAuth {
  return { cookie: "", csrf: "", token };
}

async function adult(): Promise<SessionAuth> {
  await prisma().account.create({ data: { username: "parent", displayName: "Parent", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("parent-password-1") } });
  return authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "parent", password: "parent-password-1" }) })));
}

async function agentPairing(auth: SessionAuth, scope: "readOnly" | "full", headers: Record<string, string> = {}) {
  return createInvite(request("/api/v1/paired/invites", { method: "POST", auth, headers: { ...json, ...headers }, body: JSON.stringify({ client: "agent", displayName: "Claude Code", scope }) }));
}

function claim(issued: { inviteId: string; token: string }, headers: Record<string, string> = {}) {
  return claimInvite(issued, "Claude Code on a MacBook", headers);
}

function refreshWith(refreshToken: string, headers: Record<string, string> = {}) {
  return refresh(request("/api/v1/auth/refresh", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ refreshToken }) }));
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

type Claimed = { token: string; refreshToken: string; refreshExpiresAt: string; device: { id: string; displayName: string; scope: string }; session: { username: string; expiresAt: string } };

async function connectedAgent(auth: SessionAuth, scope: "readOnly" | "full") {
  const issued = await issuedInvite(await agentPairing(auth, scope));
  const response = await claim(issued);
  expect(response.status).toBe(200);
  return { issued, claimed: (await response.json()) as Claimed };
}

describe("paired agents", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("pairs at the claim, signed in at once with a bearer and refresh token and no password or credential", async () => {
    const auth = await adult();
    const { issued, claimed } = await connectedAgent(auth, "full");
    expect(Object.keys(issued.payload).sort()).toEqual(["code", "fingerprint", "url", "version"]);
    // The address the adult made it from, where browser sign-in is only on the home network.
    expect(issued.payload.url).toBe(TEST_ORIGIN);
    expect(new Date((await prisma().pairing.findUniqueOrThrow({ where: { id: issued.id } })).expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);

    expect(claimed.session.username).toBe("parent");
    expect(claimed).not.toHaveProperty("deviceCredential");
    expect(claimed).not.toHaveProperty("connection");
    expect(new Date(claimed.session.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(new Date(claimed.refreshExpiresAt).getTime() - Date.now()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
    expect(claimed.device).toMatchObject({ displayName: "Claude Code on a MacBook", scope: "full" });
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claimed.device.id } });
    expect(device.client).toBe(PairedDeviceClient.agent);
    expect(device.accountId).toBe((await prisma().account.findUniqueOrThrow({ where: { username: "parent" } })).id);

    const status = await inviteStatus(request(`/api/v1/paired/invites/${issued.id}`, { auth }), { params: Promise.resolve({ id: issued.id }) });
    expect(((await status.json()) as { invite: { status: string } }).invite.status).toBe("claimed");
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("pairs at the home network address when one is set, not at a proxy that asks for a sign-in", async () => {
    const auth = await adult();
    // The browser is on a proxied address, such as one behind Cloudflare Access's email login.
    const proxied = { "x-forwarded-proto": "https", "x-forwarded-host": "familyfi.example.com", "cf-access-jwt-assertion": "a.b.c" };
    const before = await agentPairing(auth, "full", proxied);
    expect(((await before.clone().json()) as { invite: { url: string } }).invite.url).toBe("https://familyfi.example.com");
    expect((await issuedInvite(before)).payload.url).toBe("https://familyfi.example.com");

    const saved = await setHome(request("/api/v1/connection/home", { method: "PUT", auth, headers: json, body: JSON.stringify({ url: "http://192.168.1.10:7001/" }) }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ home: { url: "http://192.168.1.10:7001", current: { url: TEST_ORIGIN, private: false } } });
    // The address the browser is on is reported, and a proxied public one is never called private.
    expect(await (await getHome(request("/api/v1/connection/home", { auth, headers: proxied }))).json()).toEqual({
      home: { url: "http://192.168.1.10:7001", current: { url: "https://familyfi.example.com", private: false } },
    });
    expect(await (await getHome(request("/api/v1/connection/home", { auth, headers: { "x-forwarded-host": "192.168.1.10:7001" } }))).json()).toMatchObject({
      home: { current: { url: "http://192.168.1.10:7001", private: true } },
    });

    const response = await agentPairing(auth, "full", proxied);
    expect(((await response.clone().json()) as { invite: { url: string } }).invite.url).toBe("http://192.168.1.10:7001");
    const issued = await issuedInvite(response);
    expect(issued.payload.url).toBe("http://192.168.1.10:7001");
    expect((await claim(issued)).status).toBe(200);

    for (const url of ["ftp://192.168.1.10", "http://192.168.1.10:7001/familyfi", "https://user:pass@familyfi.home.arpa", "not a url"]) {
      const refused = await setHome(request("/api/v1/connection/home", { method: "PUT", auth, headers: json, body: JSON.stringify({ url }) }));
      expect(refused.status).toBe(400);
      expect(await errorCode(refused)).toBe("invalid_home_url");
    }
    const cleared = await setHome(request("/api/v1/connection/home", { method: "PUT", auth, headers: json, body: JSON.stringify({ url: null }) }));
    expect(await cleared.json()).toMatchObject({ home: { url: null } });
    expect((await issuedInvite(await agentPairing(auth, "readOnly"))).payload.url).toBe(TEST_ORIGIN);
  });

  it("claims a code once, and an agent never gets a phone's connection or a scope it cannot hold", async () => {
    const auth = await adult();
    const { issued, claimed } = await connectedAgent(auth, "readOnly");
    const again = await claim(issued);
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe("invalid_pairing");
    // Only phones and Watches, which may work away from home, get a route and manifest.
    expect(claimed).not.toHaveProperty("connection");
    expect(claimed.device).toMatchObject({ client: "agent", scope: "readOnly" });

    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    await expect(inviteAgent({ url: TEST_ORIGIN, displayName: "Agent", scope: DeviceScope.rulesOnly, createdByAccountId: parent.id })).rejects.toThrow(/cannot hold/);
  });

  it("refuses an expired code", async () => {
    const auth = await adult();
    const issued = await issuedInvite(await agentPairing(auth, "readOnly"));
    await prisma().pairing.update({ where: { id: issued.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await claim(issued)).status).toBe(403);
  });

  it("renews with its rotating refresh token, and never signs in at /auth/login", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "readOnly");
    const renewed = await refreshWith(claimed.refreshToken);
    expect(renewed.status).toBe(200);
    const body = (await renewed.json()) as Claimed;
    expect(body.token).not.toBe(claimed.token);
    expect(body.refreshToken).not.toBe(claimed.refreshToken);
    expect((await listGroups(request("/api/v1/groups", { auth: bearer(body.token) }))).status).toBe(200);
    expect((await listGroups(request("/api/v1/groups", { auth: bearer(claimed.token) }))).status).toBe(401);

    // A full sign-in body fails only because `agent` is not a sign-in client.
    const asAgent = await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "parent", password: "parent-password-1", client: "agent" }) }));
    expect(asAgent.status).toBe(400);
  });

  it("is bounded by its scope, not by the administrator it acts as", async () => {
    const auth = await adult();
    const reader = (await connectedAgent(auth, "readOnly")).claimed;
    const manager = (await connectedAgent(auth, "full")).claimed;
    const groupBody = JSON.stringify({ name: "Kids", kind: "family", familyRole: "child" });

    expect((await household(request("/api/v1/settings/household", { auth: bearer(reader.token) }))).status).toBe(200);
    const denied = await createGroup(request("/api/v1/groups", { method: "POST", auth: bearer(reader.token), headers: json, body: groupBody }));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("agent_scope");

    const created = await createGroup(request("/api/v1/groups", { method: "POST", auth: bearer(manager.token), headers: json, body: groupBody }));
    expect(created.status).toBe(201);
    const { group } = (await created.json()) as { group: { id: string } };
    const paused = await pauseGroupRule(
      request(`/api/v1/groups/${group.id}/rules/internet/pause`, { method: "POST", auth: bearer(manager.token), headers: json, body: "{}" }),
      { params: Promise.resolve({ id: group.id, ruleId: "internet" }) },
    );
    expect(paused.status).toBe(200);
    const { change } = (await paused.json()) as { change: { changeId: string } };
    const recorded = await prisma().changeResult.findUniqueOrThrow({ where: { id: change.changeId } });
    expect(recorded.actorDeviceId).toBe(manager.device.id);
    expect(recorded.actorAccountId).toBe((await prisma().account.findUniqueOrThrow({ where: { username: "parent" } })).id);

    for (const token of [reader.token, manager.token]) {
      expect((await listAccounts(request("/api/v1/accounts", { auth: bearer(token) }))).status).toBe(403);
      expect((await settingsUnifi(request("/api/v1/settings/unifi", { auth: bearer(token) }))).status).toBe(403);
      // Its manifest would carry Cloudflare Access tokens.
      expect((await connection(request("/api/v1/connection", { auth: bearer(token) }))).status).toBe(403);
      expect((await listDevices(request("/api/v1/paired/devices", { auth: bearer(token) }))).status).toBe(403);
      expect((await agentPairing(bearer(token), "full")).status).toBe(403);
    }
  });

  it("works from the home network only", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "full");
    const tunnelled = { [TUNNEL_HEADER]: "tunnel" };
    const remote = await listGroups(request("/api/v1/groups", { auth: bearer(claimed.token), headers: tunnelled }));
    expect(remote.status).toBe(403);
    expect(((await remote.json()) as { error: { code: string } }).error.code).toBe("agent_remote");
    const remoteRefresh = await refreshWith(claimed.refreshToken, tunnelled);
    expect(remoteRefresh.status).toBe(403);
    expect(await errorCode(remoteRefresh)).toBe("agent_remote");
    // Refused, not rotated: the refresh token still works at home.
    expect((await refreshWith(claimed.refreshToken)).status).toBe(200);

    const unclaimed = await issuedInvite(await agentPairing(auth, "readOnly"));
    const remoteClaim = await claim(unclaimed, tunnelled);
    expect(remoteClaim.status).toBe(403);
    expect(await errorCode(remoteClaim)).toBe("agent_remote");
    expect((await agentPairing(auth, "readOnly", tunnelled)).status).toBe(403);
  });

  it("revoking it, by an administrator or by itself, ends its bearer and its refresh token", async () => {
    const auth = await adult();
    for (const revoker of ["administrator", "itself"] as const) {
      const { claimed } = await connectedAgent(auth, "readOnly");
      const by = revoker === "itself" ? bearer(claimed.token) : auth;
      const revoked = await revokeDevice(request(`/api/v1/paired/devices/${claimed.device.id}`, { method: "DELETE", auth: by }), { params: Promise.resolve({ id: claimed.device.id }) });
      expect(revoked.status).toBe(200);
      expect((await listGroups(request("/api/v1/groups", { auth: bearer(claimed.token) }))).status).toBe(401);
      expect((await refreshWith(claimed.refreshToken)).status).toBe(403);
    }
  });

  it("lists agents with their scope for administrators", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "readOnly");
    const { devices } = (await (await listDevices(request("/api/v1/paired/devices", { auth }))).json()) as { devices: { id: string; client: string; scope: string }[] };
    expect(devices.find((device) => device.id === claimed.device.id)).toMatchObject({ client: "agent", scope: "readOnly" });
  });

  it("serves the guide without a session, with this address, and the spec to an agent's bearer", async () => {
    const guide = await agentGuide(new Request("http://192.168.1.10:7001/agents.md", { headers: { "x-forwarded-host": "192.168.1.10:7001" } }));
    expect(guide.status).toBe(200);
    expect(guide.headers.get("content-type")).toContain("text/markdown");
    const text = await guide.text();
    expect(text).toContain("http://192.168.1.10:7001/openapi");
    expect(text).not.toContain("{{");
    const proxied = await agentGuide(new Request("http://127.0.0.1:7001/agents.md", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "familyfi.home.arpa" } }));
    expect(await proxied.text()).toContain("https://familyfi.home.arpa/openapi");

    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "readOnly");
    expect((await openapi(request("/openapi", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("acts as the recovery account when that account paired it", async () => {
    const recovery = authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD }) })));
    const issued = await issuedInvite(await agentPairing(recovery, "readOnly"));
    const response = await claim(issued);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Claimed).session.username).toBe("admin");
  });

  it("is never an administrator: the admin guard refuses it even on a path its scope reaches", async () => {
    // No route lets an agent's scope reach an administrator's handler today; this pins the guard's own
    // check, so a later allowlist change cannot hand an agent administration.
    const { claimed } = await connectedAgent(await adult(), "full");
    let ran = false;
    const response = await withAdmin(request("/api/v1/groups", { auth: bearer(claimed.token) }), async () => {
      ran = true;
      return Response.json({});
    });
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("administrator_required");
    expect(ran).toBe(false);
  });
});
