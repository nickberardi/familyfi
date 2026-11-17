import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GET as getSync } from "@/app/api/v1/sync/route";
import { GET as getChange } from "@/app/api/v1/changes/[id]/route";
import { POST as createGroup } from "@/app/api/v1/groups/route";
import { POST as createInvite } from "@/app/api/v1/paired/invites/route";
import { DELETE as deleteAccount } from "@/app/api/v1/accounts/[id]/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, claimInvite, issuedInvite, pairingAdmin, pairingAdminAuth, pairPhone, PAIRING_ADMIN, type Claim } from "../helpers/pairing";

const json = { "content-type": "application/json" };

async function recoveryAuth(): Promise<SessionAuth> {
  const password = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
  const response = await login(request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password, client: "browser" }) }));
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

type Change = { id: string; actor?: { displayName: string; device?: { displayName: string } } };

async function newGroup(auth: SessionAuth, name: string): Promise<string> {
  const response = await createGroup(request("/api/v1/groups", { method: "POST", auth, headers: json, body: JSON.stringify({ name, kind: "family", familyRole: "child" }) }));
  expect(response.status).toBe(201);
  return ((await response.json()) as { change: { changeId: string } }).change.changeId;
}

async function syncChanges(auth: SessionAuth): Promise<Change[]> {
  const response = await getSync(request("/api/v1/sync", { auth }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { changes: Change[] }).changes;
}

async function oneChange(auth: SessionAuth, id: string): Promise<Change> {
  const response = await getChange(request(`/api/v1/changes/${id}`, { auth }), { params: Promise.resolve({ id }) });
  expect(response.status).toBe(200);
  return ((await response.json()) as { change: Change }).change;
}

async function connectedAgent(admin: SessionAuth): Promise<Claim> {
  const created = await createInvite(request("/api/v1/paired/invites", { method: "POST", auth: admin, headers: json, body: JSON.stringify({ clientType: "agent", displayName: "Claude Code", scope: "agent:full" }) }));
  expect(created.status).toBe(201);
  const claimed = await claimInvite(await issuedInvite(created), "Claude Code on a MacBook");
  expect(claimed.status).toBe(200);
  return (await claimed.json()) as Claim;
}

describe("who asked for each change", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("names the adult, and the paired device they used, on Sync and on the change itself", async () => {
    const admin = await pairingAdminAuth();
    const phone = await pairPhone(admin, { displayName: "Nick's iPhone" });
    const agent = await connectedAgent(admin);

    const fromWeb = await newGroup(admin, "Kids");
    const fromPhone = await newGroup(bearer(phone.token), "Teens");
    const fromAgent = await newGroup(bearer(agent.token), "Guests");

    const byId = new Map((await syncChanges(admin)).map((change) => [change.id, change]));
    expect(byId.get(fromWeb)!.actor).toEqual({ displayName: PAIRING_ADMIN.displayName });
    expect(byId.get(fromPhone)!.actor).toEqual({ displayName: PAIRING_ADMIN.displayName, device: { displayName: "Nick's iPhone" } });
    expect(byId.get(fromAgent)!.actor).toEqual({ displayName: PAIRING_ADMIN.displayName, device: { displayName: agent.device.displayName } });
    expect((await oneChange(bearer(phone.token), fromPhone)).actor).toEqual({ displayName: PAIRING_ADMIN.displayName, device: { displayName: "Nick's iPhone" } });
  });

  it("never tells an agent who the household's adults are", async () => {
    const admin = await pairingAdminAuth();
    const agent = await connectedAgent(admin);
    const fromWeb = await newGroup(admin, "Kids");

    const changes = await syncChanges(bearer(agent.token));
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((change) => !("actor" in change))).toBe(true);
    expect("actor" in (await oneChange(bearer(agent.token), fromWeb))).toBe(false);
  });

  it("leaves actor out once the adult's account is removed", async () => {
    const admin = await pairingAdminAuth();
    const fromWeb = await newGroup(admin, "Kids");
    const recovery = await recoveryAuth();
    const removed = await deleteAccount(request(`/api/v1/accounts/${(await pairingAdmin()).id}`, { method: "DELETE", auth: recovery }), {
      params: Promise.resolve({ id: (await pairingAdmin()).id }),
    });
    expect(removed.status).toBe(200);
    const change = await oneChange(recovery, fromWeb);
    expect(change).toMatchObject({ actorAccountId: null });
    expect("actor" in change).toBe(false);
    // The removal itself is the recovery admin's.
    const latest = (await syncChanges(recovery))[0]!;
    expect(latest.actor).toEqual({ displayName: (await prisma().account.findUniqueOrThrow({ where: { username: "admin" } })).displayName });
  });
});
