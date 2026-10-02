import { beforeEach, describe, expect, it } from "vitest";
import { AccountKind, PairedDeviceClient } from "@prisma/client";
import { TUNNEL_HEADER } from "@/lib/constants";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { GET as agentGuide } from "@/app/agents.md/route";
import { GET as openapi } from "@/app/openapi/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as currentSession } from "@/app/api/v1/auth/session/route";
import { GET as listAccounts } from "@/app/api/v1/accounts/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { GET as listDevices } from "@/app/api/v1/connection/devices/route";
import { DELETE as revokeDevice } from "@/app/api/v1/connection/devices/[id]/route";
import { POST as createPairing } from "@/app/api/v1/connection/pairings/route";
import { GET as pairingStatus } from "@/app/api/v1/connection/pairings/[id]/route";
import { POST as claimRoute } from "@/app/api/v1/connection/pairings/[id]/claim/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { claimAgentPairing, claimPairing } from "@/server/connection";
import { sha256 } from "@/server/crypto";
import { GET as listGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { GET as settingsUnifi } from "@/app/api/v1/settings/unifi/route";
import { GET as household } from "@/app/api/v1/settings/household/route";
import { POST as pauseGroupRule } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { issuedPairing } from "../helpers/pairing";
import { TEST_ORIGIN } from "../helpers/test-env";

const json = { "content-type": "application/json" };

function bearer(token: string): SessionAuth {
  return { cookie: "", csrf: "", token };
}

async function adult(): Promise<SessionAuth> {
  await prisma().account.create({ data: { username: "parent", displayName: "Parent", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("parent-password-1") } });
  return authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "parent", password: "parent-password-1" }) })));
}

async function agentPairing(auth: SessionAuth, grant: "read" | "controls", headers: Record<string, string> = {}) {
  return createPairing(request("/api/v1/connection/pairings", { method: "POST", auth, headers: { ...json, ...headers }, body: JSON.stringify({ client: "agent", deviceName: "Claude Code", grant }) }));
}

function claim(issued: { pairingId: string; token: string }, headers: Record<string, string> = {}) {
  return claimRoute(
    request(`/api/v1/connection/pairings/${issued.pairingId}/claim`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ token: issued.token, deviceName: "Claude Code on a MacBook" }) }),
    { params: Promise.resolve({ id: issued.pairingId }) },
  );
}

function refreshWith(refreshToken: string, headers: Record<string, string> = {}) {
  return refresh(request("/api/v1/auth/refresh", { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify({ refreshToken }) }));
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

type Claimed = { token: string; refreshToken: string; refreshExpiresAt: string; device: { id: string; displayName: string; grant: string }; session: { username: string; expiresAt: string } };

async function connectedAgent(auth: SessionAuth, grant: "read" | "controls") {
  const issued = await issuedPairing(await agentPairing(auth, grant));
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
    const { issued, claimed } = await connectedAgent(auth, "controls");
    expect(Object.keys(issued.payload).sort()).toEqual(["code", "fingerprint", "url", "version"]);
    // The address the adult made it from, where browser sign-in is only on the home network.
    expect(issued.payload.url).toBe(TEST_ORIGIN);
    expect(new Date((await prisma().pairing.findUniqueOrThrow({ where: { id: issued.id } })).expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);

    expect(claimed.session.username).toBe("parent");
    expect(claimed).not.toHaveProperty("deviceCredential");
    expect(claimed).not.toHaveProperty("manifest");
    expect(new Date(claimed.session.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(new Date(claimed.refreshExpiresAt).getTime() - Date.now()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
    expect(claimed.device).toMatchObject({ displayName: "Claude Code on a MacBook", grant: "controls" });
    const device = await prisma().pairedDevice.findUniqueOrThrow({ where: { id: claimed.device.id } });
    expect(device.client).toBe(PairedDeviceClient.agent);
    expect(device.accountId).toBe((await prisma().account.findUniqueOrThrow({ where: { username: "parent" } })).id);

    const status = await pairingStatus(request(`/api/v1/connection/pairings/${issued.id}`, { auth }), { params: Promise.resolve({ id: issued.id }) });
    expect(((await status.json()) as { pairing: { status: string } }).pairing.status).toBe("claimed");
    expect((await currentSession(request("/api/v1/auth/session", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("claims a code once, and only as an agent", async () => {
    const auth = await adult();
    const { issued } = await connectedAgent(auth, "read");
    const again = await claim(issued);
    expect(again.status).toBe(403);
    expect(await errorCode(again)).toBe("invalid_pairing");

    // The phone claim never takes an agent's code, so no agent gets a phone's credential and manifest.
    const unclaimed = await issuedPairing(await agentPairing(auth, "read"));
    expect(await claimPairing({ id: unclaimed.pairingId, token: unclaimed.token, displayName: "Phone" })).toBeNull();
    // Nor does the agent claim take a phone's code.
    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    const phoneToken = "phone-pairing-token";
    const phonePairing = await prisma().pairing.create({ data: { displayName: "Phone", createdByAccountId: parent.id, tokenHash: sha256(phoneToken), expiresAt: new Date(Date.now() + 60_000) } });
    expect(await claimAgentPairing({ id: phonePairing.id, token: phoneToken })).toBeNull();
  });

  it("refuses an expired code", async () => {
    const auth = await adult();
    const issued = await issuedPairing(await agentPairing(auth, "read"));
    await prisma().pairing.update({ where: { id: issued.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await claim(issued)).status).toBe(403);
  });

  it("renews with its rotating refresh token, and never signs in at /auth/login", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "read");
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

  it("is bounded by its grant, not by the administrator it acts as", async () => {
    const auth = await adult();
    const reader = (await connectedAgent(auth, "read")).claimed;
    const manager = (await connectedAgent(auth, "controls")).claimed;
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
      expect((await listDevices(request("/api/v1/connection/devices", { auth: bearer(token) }))).status).toBe(403);
      expect((await agentPairing(bearer(token), "controls")).status).toBe(403);
    }
  });

  it("works from the home network only", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "controls");
    const tunnelled = { [TUNNEL_HEADER]: "tunnel" };
    const remote = await listGroups(request("/api/v1/groups", { auth: bearer(claimed.token), headers: tunnelled }));
    expect(remote.status).toBe(403);
    expect(((await remote.json()) as { error: { code: string } }).error.code).toBe("agent_remote");
    const remoteRefresh = await refreshWith(claimed.refreshToken, tunnelled);
    expect(remoteRefresh.status).toBe(403);
    expect(await errorCode(remoteRefresh)).toBe("agent_remote");
    // Refused, not rotated: the refresh token still works at home.
    expect((await refreshWith(claimed.refreshToken)).status).toBe(200);

    const unclaimed = await issuedPairing(await agentPairing(auth, "read"));
    const remoteClaim = await claim(unclaimed, tunnelled);
    expect(remoteClaim.status).toBe(403);
    expect(await errorCode(remoteClaim)).toBe("agent_remote");
    expect((await agentPairing(auth, "read", tunnelled)).status).toBe(403);
  });

  it("revoking it, by an administrator or by itself, ends its bearer and its refresh token", async () => {
    const auth = await adult();
    for (const revoker of ["administrator", "itself"] as const) {
      const { claimed } = await connectedAgent(auth, "read");
      const by = revoker === "itself" ? bearer(claimed.token) : auth;
      const revoked = await revokeDevice(request(`/api/v1/connection/devices/${claimed.device.id}`, { method: "DELETE", auth: by }), { params: Promise.resolve({ id: claimed.device.id }) });
      expect(revoked.status).toBe(200);
      expect((await listGroups(request("/api/v1/groups", { auth: bearer(claimed.token) }))).status).toBe(401);
      expect((await refreshWith(claimed.refreshToken)).status).toBe(403);
    }
  });

  it("lists agents with their grant for administrators", async () => {
    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "read");
    const { devices } = (await (await listDevices(request("/api/v1/connection/devices", { auth }))).json()) as { devices: { id: string; client: string; grant: string | null }[] };
    expect(devices.find((device) => device.id === claimed.device.id)).toMatchObject({ client: "agent", grant: "read" });
  });

  it("serves the guide without a session, with this address, and the spec to an agent's bearer", async () => {
    const guide = await agentGuide(new Request("http://192.168.1.10:7001/agents.md", { headers: { host: "192.168.1.10:7001" } }));
    expect(guide.status).toBe(200);
    expect(guide.headers.get("content-type")).toContain("text/markdown");
    const text = await guide.text();
    expect(text).toContain("http://192.168.1.10:7001/openapi");
    expect(text).not.toContain("{{");
    const proxied = await agentGuide(new Request("http://127.0.0.1:7001/agents.md", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "familyfi.home.arpa" } }));
    expect(await proxied.text()).toContain("https://familyfi.home.arpa/openapi");

    const auth = await adult();
    const { claimed } = await connectedAgent(auth, "read");
    expect((await openapi(request("/openapi", { auth: bearer(claimed.token) }))).status).toBe(200);
  });

  it("acts as the recovery account when that account paired it", async () => {
    const recovery = authFromLogin(await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD }) })));
    const issued = await issuedPairing(await agentPairing(recovery, "read"));
    const response = await claim(issued);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Claimed).session.username).toBe("admin");
  });
});
