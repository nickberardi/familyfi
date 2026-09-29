import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as deleteGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as createRule } from "@/app/api/v1/rules/route";
import { POST as pause } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as resume } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { POST as extend } from "@/app/api/v1/groups/[id]/rules/[ruleId]/extend/route";
import { GET as getDevices } from "@/app/api/v1/devices/route";
import { PUT as assignDevice } from "@/app/api/v1/devices/[mac]/assignment/route";
import { GET as getDevice, DELETE as deleteDevice } from "@/app/api/v1/devices/[mac]/route";
import { GET as getSync } from "@/app/api/v1/sync/route";
import { POST as retrySync } from "@/app/api/v1/sync/retry/route";
import { GET as getChange } from "@/app/api/v1/changes/[id]/route";
import { GET as getHousehold, PUT as putHousehold } from "@/app/api/v1/settings/household/route";
import { GET as getUnifi } from "@/app/api/v1/settings/unifi/route";
import { prisma } from "@/server/db";
import { AssignmentState } from "@prisma/client";
import { authFromLogin, request } from "../helpers/http";
import { createFamilyGroup, INTERNAL_NETWORK, INTERNAL_ZONE, resetDatabase, seedDevice } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function signedIn() {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

describe("v1 API contracts", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("exposes the same nullable connection details on list and single-device reads", async () => {
    const mac = "02:00:00:00:00:01";
    await seedDevice({ mac, networkId: INTERNAL_NETWORK, zoneId: INTERNAL_ZONE });
    const auth = await signedIn();
    const unknown = await getDevice(request(`/api/v1/devices/${mac}`, { auth }), { params: Promise.resolve({ mac }) });
    expect((await unknown.json()).device.presence).toBe("unknown");

    const checkedAt = new Date();
    const connectedAt = new Date(checkedAt.getTime() - 60_000);
    await prisma().device.update({
      where: { mac },
      data: { presenceOnline: true, presenceCheckedAt: checkedAt, connectedAt, connectionType: "wireless", accessPointName: "Upstairs AP", manufacturer: "Example Registrant" },
    });
    const list = await getDevices(request("/api/v1/devices", { auth }));
    const single = await getDevice(request(`/api/v1/devices/${mac}`, { auth }), { params: Promise.resolve({ mac }) });
    const listed = (await list.json()).devices[0];
    const detail = (await single.json()).device;
    expect(detail).toEqual(listed);
    expect(detail).toMatchObject({
      manufacturer: "Example Registrant",
      presence: "online",
      presenceCheckedAt: checkedAt.toISOString(),
      connectedAt: connectedAt.toISOString(),
      connectionType: "wireless",
      accessPointName: "Upstairs AP",
    });
  });

  it("deletes known devices with mutation authorization and queues reconciliation", async () => {
    const mac = "02:00:00:00:00:01";
    const path = `/api/v1/devices/${encodeURIComponent(mac)}`;
    const ctx = { params: Promise.resolve({ mac }) };
    await seedDevice({ mac });
    expect((await deleteDevice(request(path, { method: "DELETE" }), ctx)).status).toBe(401);

    const auth = await signedIn();
    const noCsrf = request(path, {
      method: "DELETE",
      headers: { cookie: auth.cookie },
    });
    expect((await deleteDevice(noCsrf, ctx)).status).toBe(403);
    expect(await prisma().device.count({ where: { mac } })).toBe(1);

    const invalid = await deleteDevice(
      request("/api/v1/devices/invalid", { method: "DELETE", auth }),
      { params: Promise.resolve({ mac: "invalid" }) },
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_mac");

    const missing = await deleteDevice(
      request("/api/v1/devices/02:00:00:00:00:99", { method: "DELETE", auth }),
      { params: Promise.resolve({ mac: "02:00:00:00:00:99" }) },
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");

    const deleted = await deleteDevice(request(path, { method: "DELETE", auth }), ctx);
    expect(deleted.status).toBe(200);
    const body = (await deleted.json()) as { ok: boolean; change: { changeId: string; revision: number } };
    expect(body.ok).toBe(true);
    expect(body.change.changeId).toEqual(expect.any(String));
    expect(await prisma().device.count({ where: { mac } })).toBe(0);
    const change = await prisma().changeResult.findUniqueOrThrow({ where: { id: body.change.changeId } });
    expect(change.scope).toBe("device");
    expect(change.deviceMac).toBe(mac);
  });

  it("requires a session for household routes and accepts timezone updates", async () => {
    const anon = await getGroups(request("/api/v1/groups"));
    expect(anon.status).toBe(401);

    const auth = await signedIn();
    const created = await createGroup(
      request("/api/v1/groups", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "family", name: "Betsy", familyRole: "child" }),
      }),
    );
    expect(created.status).toBe(201);
    const groupBody = (await created.json()) as { group: { id: string }; change: { changeId: string; revision: number } };
    const spec = YAML.parse(readFileSync(path.join(process.cwd(), "openapi/familyfi.v1.yaml"), "utf8")) as {
      components: { schemas: { ChangeSummary: { required: string[]; properties: Record<string, unknown> } } };
    };
    const summarySchema = spec.components.schemas.ChangeSummary;
    expect(Object.keys(groupBody.change).sort()).toEqual(summarySchema.required.toSorted());
    expect(Object.keys(groupBody.change).sort()).toEqual(Object.keys(summarySchema.properties).sort());
    expect(groupBody.change.changeId).toEqual(expect.any(String));
    expect(groupBody.change.revision).toBeGreaterThan(0);

    const listed = await getGroups(request("/api/v1/groups", { auth }));
    expect(listed.status).toBe(200);

    const scheduled = await createRule(
      request("/api/v1/rules", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bedtime",
          kind: "internet",
          groupIds: [groupBody.group.id],
          mode: "scheduled",
          windows: [{ days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }],
        }),
      }),
    );
    expect(scheduled.status).toBe(201);

    const paused = await pause(
      request(`/api/v1/groups/${groupBody.group.id}/rules/internet/pause`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ until: new Date(Date.now() + 3_600_000).toISOString() }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id, ruleId: "internet" }) },
    );
    expect(paused.status).toBe(200);

    const extended = await extend(
      request(`/api/v1/groups/${groupBody.group.id}/rules/internet/extend`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: 15 }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id, ruleId: "internet" }) },
    );
    expect(extended.status).toBe(200);

    const resumed = await resume(
      request(`/api/v1/groups/${groupBody.group.id}/rules/internet/resume`, { method: "POST", auth }),
      { params: Promise.resolve({ id: groupBody.group.id, ruleId: "internet" }) },
    );
    expect(resumed.status).toBe(200);

    await seedDevice({
      mac: "02:00:00:00:00:01",
      zoneId: INTERNAL_ZONE,
      networkId: INTERNAL_NETWORK,
    });
    const devices = await getDevices(request("/api/v1/devices?assignment=quarantined", { auth }));
    expect(devices.status).toBe(200);
    const assigned = await assignDevice(
      request("/api/v1/devices/02%3A00%3A00%3A00%3A00%3A01/assignment", {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: groupBody.group.id }),
      }),
      { params: Promise.resolve({ mac: "02:00:00:00:00:01" }) },
    );
    expect(assigned.status).toBe(200);
    const one = await getDevice(request("/api/v1/devices/02:00:00:00:00:01", { auth }), {
      params: Promise.resolve({ mac: "02:00:00:00:00:01" }),
    });
    expect(one.status).toBe(200);

    const household = await putHousehold(
      request("/api/v1/settings/household", {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: "America/Chicago" }),
      }),
    );
    expect(household.status).toBe(200);
    const readHousehold = await getHousehold(request("/api/v1/settings/household", { auth }));
    expect(await readHousehold.json()).toMatchObject({ household: { timezone: "America/Chicago" } });

    const unifi = await getUnifi(request("/api/v1/settings/unifi", { auth }));
    const unifiBody = await unifi.json();
    expect(JSON.stringify(unifiBody)).not.toMatch(/apiKey[^M]|ciphertext|FAMILYFI_DEFAULT_PASSWORD/);

    const sync = await getSync(request("/api/v1/sync", { auth }));
    expect(sync.status).toBe(200);
    const retried = await retrySync(request("/api/v1/sync/retry", { method: "POST", auth }));
    expect(retried.status).toBe(200);

    const change = await getChange(request(`/api/v1/changes/${groupBody.change.changeId}`, { auth }), {
      params: Promise.resolve({ id: groupBody.change.changeId }),
    });
    expect(change.status).toBe(200);
    const changeBody = (await change.json()) as { change: { status: string } };
    expect(["pending", "applied", "partial", "failed", "superseded"]).toContain(changeBody.change.status);

    const removed = await deleteGroup(request(`/api/v1/groups/${groupBody.group.id}`, { method: "DELETE", auth }), {
      params: Promise.resolve({ id: groupBody.group.id }),
    });
    expect(removed.status).toBe(200);
    const device = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(device.assignment).toBe(AssignmentState.quarantined);
    expect(device.groupId).toBeNull();
  });

  it("counts rule policies with app-owned policies on the sync page, and their errors as failing", async () => {
    const auth = await signedIn();
    const group = await createFamilyGroup("Sync");
    const rule = await prisma().rule.findFirstOrThrow({ where: { groups: { some: { groupId: group.id } } }, include: { windows: true } });
    const owned = { connectionIdentity: "console", siteId: "site", zoneId: INTERNAL_ZONE, desiredFingerprint: "fp", desiredRevision: 1 };
    await prisma().appPolicy.create({ data: { ...owned, unifiPolicyId: "pol-quarantine", ownerScope: "quarantine", ipVersion: "dual" } });
    await prisma().rulePolicy.create({
      data: { ...owned, ruleId: rule.id, windowKey: rule.windows[0]!.id, unifiPolicyId: "pol-bedtime", lastError: "UniFi PUT failed: 400" },
    });

    const sync = await getSync(request("/api/v1/sync", { auth }));
    expect(sync.status).toBe(200);
    const body = (await sync.json()) as { appPolicyCount: number; failingCount: number };
    expect(body.appPolicyCount).toBe(2);
    expect(body.failingCount).toBe(1);
  });

  it("starts a group with no internet rule, and pauses and resumes all its internet", async () => {
    const auth = await signedIn();
    const created = await createGroup(
      request("/api/v1/groups", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "family", name: "New Kid", familyRole: "child" }),
      }),
    );
    expect(created.status).toBe(201);
    type Body = { group: { id: string; access: string; internetRuleIds: string[]; suspension: { active: boolean; by: { name: string } | null } } };
    const groupBody = (await created.json()) as Body;
    expect(groupBody.group.internetRuleIds).toEqual([]);
    expect(groupBody.group.access).toBe("available");

    const paused = await pause(
      request(`/api/v1/groups/${groupBody.group.id}/rules/internet/pause`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: groupBody.group.id, ruleId: "internet" }) },
    );
    expect(paused.status).toBe(200);
    const pausedBody = (await paused.json()) as Body;
    expect(pausedBody.group.access).toBe("paused");
    expect(pausedBody.group.suspension.by?.name).toEqual(expect.any(String));

    const resumed = await resume(
      request(`/api/v1/groups/${groupBody.group.id}/rules/internet/resume`, { method: "POST", auth }),
      { params: Promise.resolve({ id: groupBody.group.id, ruleId: "internet" }) },
    );
    expect(resumed.status).toBe(200);
    const resumedBody = (await resumed.json()) as Body;
    expect(resumedBody.group.access).toBe("available");
    expect(resumedBody.group.suspension).toEqual({ active: false, until: null, by: null });
  });
});
