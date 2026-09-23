import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listChecks } from "@/app/api/v1/upstream/checks/route";
import { POST as runChecks } from "@/app/api/v1/upstream/checks/run/route";
import { POST as checkCategory } from "@/app/api/v1/upstream/categories/[id]/check/route";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const RESOLVER = "https://doh.familyfi.test/dns-query";

async function signedIn(): Promise<SessionAuth> {
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

async function seedCategory(domains: string[]) {
  return prisma().upstreamCategory.create({
    data: {
      slug: "test-category",
      label: "Test category",
      monogram: "TC",
      domains: { create: domains.map((domain) => ({ domain, source: "user" as const })) },
    },
  });
}

/**
 * A DNS-over-HTTPS resolver on the wire: NXDOMAIN (blocked) for `blocked`, an ordinary
 * address (open) for everything else. It echoes the query's id and question, as a real
 * resolver does, so the probe's own id and decoding checks run unchanged.
 */
function stubResolver(blocked: Set<string>) {
  const asked: string[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(RESOLVER);
    const query = new Uint8Array(init!.body as ArrayBuffer);
    let offset = 12;
    const labels: string[] = [];
    while (query[offset] !== 0) {
      const length = query[offset];
      labels.push(String.fromCharCode(...query.slice(offset + 1, offset + 1 + length)));
      offset += 1 + length;
    }
    const questionEnd = offset + 1 + 4;
    const name = labels.join(".");
    asked.push(name);
    const isBlocked = blocked.has(name);
    const answer = isBlocked ? [] : [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 93, 184, 216, 34];
    const header = [query[0], query[1], 0x81, isBlocked ? 0x83 : 0x80, 0, 1, 0, isBlocked ? 0 : 1, 0, 0, 0, 0];
    const body = new Uint8Array([...header, ...query.slice(12, questionEnd), ...answer]);
    return new Response(body, { headers: { "content-type": "application/dns-message" } });
  });
  vi.stubGlobal("fetch", fetchStub);
  return { asked };
}

const categoryCtx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("upstream check routes", () => {
  let auth: SessionAuth;

  beforeEach(async () => {
    await resetDatabase();
    auth = await signedIn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("need a session, and the two that run a probe also need the CSRF header", async () => {
    const category = await seedCategory(["one.example"]);
    expect((await listChecks(request("/api/v1/upstream/checks"))).status).toBe(401);
    expect((await runChecks(request("/api/v1/upstream/checks/run", { method: "POST" }))).status).toBe(401);
    const checkPath = `/api/v1/upstream/categories/${category.id}/check`;
    expect((await checkCategory(request(checkPath, { method: "POST" }), categoryCtx(category.id))).status).toBe(401);

    const withoutCsrf = { headers: { cookie: auth.cookie }, method: "POST" };
    expect((await runChecks(request("/api/v1/upstream/checks/run", withoutCsrf))).status).toBe(403);
    expect((await checkCategory(request(checkPath, withoutCsrf), categoryCtx(category.id))).status).toBe(403);
    expect(await prisma().upstreamCheck.count()).toBe(0);
  });

  it("reports an unknown category as not found", async () => {
    const response = await checkCategory(
      request("/api/v1/upstream/categories/missing/check", { method: "POST", auth }),
      categoryCtx("missing"),
    );
    expect(response.status).toBe(404);
  });

  it("records unknown, never open, when no resolver is set", async () => {
    const category = await seedCategory(["one.example", "two.example"]);
    const checked = await checkCategory(
      request(`/api/v1/upstream/categories/${category.id}/check`, { method: "POST", auth }),
      categoryCtx(category.id),
    );
    expect(checked.status).toBe(200);
    const { category: body } = (await checked.json()) as { category: { checks: { verdict: string }[] } };
    expect(body.checks.map((check) => check.verdict)).toEqual(["unknown"]);

    const run = await runChecks(request("/api/v1/upstream/checks/run", { method: "POST", auth }));
    const { outcomes } = (await run.json()) as { outcomes: { verdict: string }[] };
    expect(outcomes.map((outcome) => outcome.verdict)).toEqual(["unknown"]);

    const listed = (await (await listChecks(request("/api/v1/upstream/checks", { auth }))).json()) as {
      checks: { slug: string; verdict: string }[];
    };
    expect(listed.checks).toEqual([expect.objectContaining({ slug: "test-category", verdict: "unknown" })]);
  });

  it("records unknown, never open, when the resolver cannot be reached", async () => {
    const category = await seedCategory(["one.example"]);
    await prisma().household.update({ where: { id: "default" }, data: { dohUrl: RESOLVER } });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const checked = await checkCategory(
      request(`/api/v1/upstream/categories/${category.id}/check`, { method: "POST", auth }),
      categoryCtx(category.id),
    );
    const { category: body } = (await checked.json()) as { category: { checks: { verdict: string }[] } };
    expect(body.checks.map((check) => check.verdict)).toEqual(["unknown"]);
  });

  it("measures each domain through the household resolver and lists the result", async () => {
    const category = await seedCategory(["blocked.example", "open.example"]);
    await prisma().household.update({ where: { id: "default" }, data: { dohUrl: RESOLVER } });
    const resolver = stubResolver(new Set(["blocked.example"]));

    const checked = await checkCategory(
      request(`/api/v1/upstream/categories/${category.id}/check`, { method: "POST", auth }),
      categoryCtx(category.id),
    );
    expect(checked.status).toBe(200);
    const { category: body } = (await checked.json()) as {
      category: { checks: { verdict: string; blockedCount: number; totalCount: number }[] };
    };
    expect(body.checks).toEqual([expect.objectContaining({ verdict: "partial", blockedCount: 1, totalCount: 2 })]);
    expect(resolver.asked).toEqual(expect.arrayContaining(["blocked.example", "open.example"]));

    const run = await runChecks(request("/api/v1/upstream/checks/run", { method: "POST", auth }));
    expect(run.status).toBe(200);
    expect(((await run.json()) as { outcomes: unknown[] }).outcomes).toEqual([
      { categoryId: category.id, slug: "test-category", verdict: "partial", blockedCount: 1, totalCount: 2 },
    ]);

    const listed = (await (await listChecks(request("/api/v1/upstream/checks", { auth }))).json()) as {
      checks: { categoryId: string; verdict: string }[];
    };
    expect(listed.checks).toEqual([expect.objectContaining({ categoryId: category.id, verdict: "partial" })]);
  });

  it("leaves a disabled category's last result alone on a full run", async () => {
    const category = await seedCategory(["one.example"]);
    await prisma().upstreamCategory.update({ where: { id: category.id }, data: { enabled: false } });
    const run = await runChecks(request("/api/v1/upstream/checks/run", { method: "POST", auth }));
    expect(((await run.json()) as { outcomes: unknown[] }).outcomes).toEqual([]);
    expect(await prisma().upstreamCheck.count()).toBe(0);
  });
});
