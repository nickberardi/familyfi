import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getHousehold, PUT as setHousehold, DELETE as clearHousehold } from "@/app/api/v1/upstream/resolver/route";
import { PUT as setGroup, DELETE as clearGroup } from "@/app/api/v1/groups/[id]/resolver/route";
import { prisma } from "@/server/db";
import { probeCategory } from "@/server/upstream/probe";
import { authFromLogin, request } from "../helpers/http";
import { invalidRequest } from "../helpers/openapi-responses";
import { createFamilyGroup, resetDatabase } from "../helpers/db";

const OLD_URL = "https://old.example/dns-query";
const NEW_URL = "https://new.example/dns-query";

async function setup() {
  const response = await login(request("/api/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD, client: "browser" }),
  }));
  expect(response.status).toBe(200);
  const auth = authFromLogin(response);
  const group = await createFamilyGroup();
  // Every resolver change re-arms the schedule and sweeps if a run is due. With no run on
  // record one always is, and that background sweep's real DNS request rewrites the
  // checks these tests compare. A run recorded a day ahead leaves nothing due.
  await prisma().household.update({
    where: { id: "default" },
    data: { dohUrl: OLD_URL, dohProbeEnabled: true, dohProbeLastRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  await prisma().group.update({ where: { id: group.id }, data: { dohOverrideUrl: OLD_URL } });
  const category = await prisma().upstreamCategory.create({
    data: {
      slug: "test", label: "Test", monogram: "T", source: "user",
      domains: { create: { domain: "example.com", source: "user" } },
    },
  });
  await prisma().upstreamCheck.createMany({ data: [null, group.id].map((groupId) => ({
    categoryId: category.id, groupId, verdict: "blocked", blockedCount: 1,
    totalCount: 1, results: [], durationMs: 1,
  })) });
  async function change(owner: "household" | "group", method: "PUT" | "DELETE", body?: unknown) {
    const path = owner === "household" ? "/api/v1/upstream/resolver" : `/api/v1/groups/${group.id}/resolver`;
    const req = request(path, {
      auth, method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const res = owner === "household"
      ? await (method === "PUT" ? setHousehold : clearHousehold)(req)
      : await (method === "PUT" ? setGroup : clearGroup)(req, { params: Promise.resolve({ id: group.id }) });
    expect(res.status).toBe(200);
  }
  return { category, group, change };
}

describe("resolver verdict invalidation", () => {
  beforeEach(resetDatabase);

  it.each(["household", "group"] as const)("invalidates only the %s checks on replacement", async (owner) => {
    const { group, change } = await setup();
    await change(owner, "PUT", { url: NEW_URL });
    const rows = await prisma().upstreamCheck.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.groupId).toBe(owner === "household" ? group.id : null);
  });

  it.each(["household", "group"] as const)("preserves %s checks when the URL does not change", async (owner) => {
    const { change } = await setup();
    const before = await prisma().upstreamCheck.findMany({ orderBy: { id: "asc" } });
    await change(owner, "PUT", { url: OLD_URL });
    await change("household", "PUT", { probeEnabled: false });
    expect(await prisma().upstreamCheck.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it.each([
    ["household", "PUT"], ["household", "DELETE"], ["group", "PUT"], ["group", "DELETE"],
  ] as const)("discards an in-flight result after %s %s", async (owner, method) => {
    const { category, group, change } = await setup();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const fetchImpl = (async (_url, init) => {
      started();
      await pending;
      const query = new Uint8Array(init!.body as ArrayBuffer);
      const reply = new Uint8Array(12);
      const view = new DataView(reply.buffer);
      view.setUint16(0, new DataView(query.buffer).getUint16(0));
      view.setUint16(2, 0x8183); // NXDOMAIN, measured at the old endpoint
      return new Response(reply);
    }) as typeof fetch;
    const probe = probeCategory(category.id, { fetchImpl });
    await entered;
    try {
      await change(owner, method, method === "PUT" ? { url: NEW_URL } : undefined);
    } finally {
      release();
    }
    await probe;
    expect(await prisma().upstreamCheck.count({
      where: { categoryId: category.id, groupId: owner === "household" ? null : group.id },
    })).toBe(0);
    expect(await prisma().upstreamCheck.count()).toBe(1);
  });
});

describe("resolver check schedule", () => {
  beforeEach(resetDatabase);

  async function login_() {
    const response = await login(request("/api/v1/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: process.env.FAMILYFI_DEFAULT_PASSWORD, client: "browser" }),
    }));
    expect(response.status).toBe(200);
    return authFromLogin(response);
  }

  it("round-trips probeTime and probeDays", async () => {
    const auth = await login_();
    await prisma().household.update({ where: { id: "default" }, data: { dohUrl: OLD_URL } });
    const res = await setHousehold(request("/api/v1/upstream/resolver", {
      auth, method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ probeTime: "09:30", probeDays: [1, 3, 5] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolver.probeTime).toBe("09:30");
    expect(body.resolver.probeDays).toEqual([1, 3, 5]);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.dohProbeTime).toBe("09:30");
    expect(household.dohProbeDays).toEqual([1, 3, 5]);
  });

  it("rejects a malformed probeTime", async () => {
    const auth = await login_();
    const res = await setHousehold(invalidRequest(request("/api/v1/upstream/resolver", {
      auth, method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ probeTime: "25:99" }),
    })));
    expect(res.status).toBe(400);
    expect((await res.json()).error?.code).toBe("invalid_probe_time");
  });

  it("rejects an out-of-range day", async () => {
    const auth = await login_();
    const res = await setHousehold(invalidRequest(request("/api/v1/upstream/resolver", {
      auth, method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ probeDays: [0, 7] }),
    })));
    expect(res.status).toBe(400);
  });

  it("carries nextRunAt on GET when checking is on, and null when off", async () => {
    const auth = await login_();
    await prisma().household.update({
      where: { id: "default" },
      data: { dohUrl: OLD_URL, dohProbeEnabled: true, dohProbeTime: "12:00", dohProbeDays: [0, 1, 2, 3, 4, 5, 6] },
    });
    const on = await getHousehold(request("/api/v1/upstream/resolver", { auth }));
    expect((await on.json()).resolver.nextRunAt).not.toBeNull();

    await prisma().household.update({ where: { id: "default" }, data: { dohProbeEnabled: false } });
    const off = await getHousehold(request("/api/v1/upstream/resolver", { auth }));
    expect((await off.json()).resolver.nextRunAt).toBeNull();
  });
});
