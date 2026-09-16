import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as deleteGroup } from "@/app/api/v1/groups/[id]/route";
import { PUT as putSchedule } from "@/app/api/v1/groups/[id]/schedule/route";
import { POST as pause } from "@/app/api/v1/groups/[id]/pause/route";
import { POST as resume } from "@/app/api/v1/groups/[id]/resume/route";
import { POST as extend } from "@/app/api/v1/groups/[id]/extend/route";
import { GET as getDevices } from "@/app/api/v1/devices/route";
import { PUT as assignDevice } from "@/app/api/v1/devices/[mac]/assignment/route";
import { GET as getDevice } from "@/app/api/v1/devices/[mac]/route";
import { GET as getSync } from "@/app/api/v1/sync/route";
import { POST as retrySync } from "@/app/api/v1/sync/retry/route";
import { GET as getChange } from "@/app/api/v1/changes/[id]/route";
import { GET as getHousehold, PUT as putHousehold } from "@/app/api/v1/settings/household/route";
import { GET as getUnifi } from "@/app/api/v1/settings/unifi/route";
import { prisma } from "@/server/db";
import { AssignmentState } from "@prisma/client";
import { authFromLogin, request } from "../helpers/http";
import { INTERNAL_NETWORK, INTERNAL_ZONE, resetDatabase, seedDevice } from "../helpers/db";

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
    expect(groupBody.change.revision).toBeGreaterThan(0);

    const listed = await getGroups(request("/api/v1/groups", { auth }));
    expect(listed.status).toBe(200);

    const scheduled = await putSchedule(
      request(`/api/v1/groups/${groupBody.group.id}/schedule`, {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(scheduled.status).toBe(200);

    const paused = await pause(
      request(`/api/v1/groups/${groupBody.group.id}/pause`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ until: new Date(Date.now() + 3_600_000).toISOString() }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(paused.status).toBe(200);

    const extended = await extend(
      request(`/api/v1/groups/${groupBody.group.id}/extend`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: 15 }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(extended.status).toBe(200);

    const resumed = await resume(
      request(`/api/v1/groups/${groupBody.group.id}/resume`, { method: "POST", auth }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
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

  it("pauses and resumes an Always group without schedule", async () => {
    const auth = await signedIn();
    const created = await createGroup(
      request("/api/v1/groups", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "family", name: "Always Kid", familyRole: "child" }),
      }),
    );
    expect(created.status).toBe(201);
    const groupBody = (await created.json()) as { group: { id: string; mode: string; access: string } };
    expect(groupBody.group.mode).toBe("always");
    expect(groupBody.group.access).toBe("always_on");

    const paused = await pause(
      request(`/api/v1/groups/${groupBody.group.id}/pause`, {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(paused.status).toBe(200);
    const pausedBody = (await paused.json()) as { group: { access: string; mode: string } };
    expect(pausedBody.group.access).toBe("paused");
    expect(pausedBody.group.mode).toBe("always");

    const resumed = await resume(
      request(`/api/v1/groups/${groupBody.group.id}/resume`, { method: "POST", auth }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(resumed.status).toBe(200);
    const resumedBody = (await resumed.json()) as {
      group: { access: string; mode: string; schedule: { enabled: boolean }; suspension: { active: boolean } };
    };
    expect(resumedBody.group.mode).toBe("always");
    expect(resumedBody.group.access).toBe("always_on");
    expect(resumedBody.group.schedule.enabled).toBe(false);
    expect(resumedBody.group.suspension.active).toBe(false);
  });

  it("schedule PUT flips mode between always and scheduled", async () => {
    const auth = await signedIn();
    const created = await createGroup(
      request("/api/v1/groups", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "family", name: "Mode Flip", familyRole: "child" }),
      }),
    );
    const groupBody = (await created.json()) as { group: { id: string; mode: string } };
    expect(groupBody.group.mode).toBe("always");

    const scheduled = await putSchedule(
      request(`/api/v1/groups/${groupBody.group.id}/schedule`, {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(scheduled.status).toBe(200);
    const scheduledBody = (await scheduled.json()) as { group: { mode: string; schedule: { enabled: boolean } } };
    expect(scheduledBody.group.mode).toBe("scheduled");
    expect(scheduledBody.group.schedule.enabled).toBe(true);

    const always = await putSchedule(
      request(`/api/v1/groups/${groupBody.group.id}/schedule`, {
        method: "PUT",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false, days: [1, 2, 3, 4, 5], start: "21:30", end: "06:45" }),
      }),
      { params: Promise.resolve({ id: groupBody.group.id }) },
    );
    expect(always.status).toBe(200);
    const alwaysBody = (await always.json()) as { group: { mode: string; schedule: { enabled: boolean }; access: string } };
    expect(alwaysBody.group.mode).toBe("always");
    expect(alwaysBody.group.schedule.enabled).toBe(false);
    expect(alwaysBody.group.access).toBe("always_on");
  });

  it("rejects pause on a protected group", async () => {
    const auth = await signedIn();
    const created = await createGroup(
      request("/api/v1/groups", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "family", name: "Nick", familyRole: "adult", protected: true }),
      }),
    );
    const group = (await created.json()) as { group: { id: string } };
    const paused = await pause(
      request(`/api/v1/groups/${group.group.id}/pause`, { method: "POST", auth, body: "{}" }),
      { params: Promise.resolve({ id: group.group.id }) },
    );
    expect(paused.status).toBe(409);
  });
});
