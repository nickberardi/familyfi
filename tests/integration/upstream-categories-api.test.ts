import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamSource, UpstreamVerdict } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as createCategoryRoute } from "@/app/api/v1/upstream/categories/route";
import { GET as getCategoryRoute, PATCH as patchCategoryRoute } from "@/app/api/v1/upstream/categories/[id]/route";
import { prisma } from "@/server/db";
import {
  createUpstreamCategory,
  deleteUpstreamCategory,
  listUpstreamCategories,
  updateUpstreamCategory,
  UpstreamCategoryCreateBody,
  UpstreamCategoryUpdateBody,
} from "@/server/upstream/categories";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { refreshResolverContexts } from "@/server/upstream/discovery";
import { domainVerdict, effectiveCheck, type UpstreamCheckRow } from "@/lib/upstream";
import { answered } from "../helpers/answered";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

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

type PublicCategory = {
  id: string;
  slug: string;
  label: string;
  monogram: string;
  source: "seed" | "user";
  enabled: boolean;
  domains: { domain: string; source: "seed" | "user"; removed: boolean }[];
  activeDomainCount: number;
  costNote: string;
  checks: UpstreamCheckRow[];
};

const json = { "content-type": "application/json" };

async function categories() {
  const response = await answered("GET /api/v1/upstream/categories", async () => ({ categories: await listUpstreamCategories() }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { categories: PublicCategory[] }).categories;
}

async function bySlug(slug: string) {
  const all = await categories();
  const found = all.find((category) => category.slug === slug);
  expect(found, slug).toBeTruthy();
  return found!;
}

/** Creates a category. A body the request schema refuses goes through the route, whose refusal that is. */
async function createCategory(body: Record<string, unknown>) {
  const parsed = UpstreamCategoryCreateBody.safeParse(body);
  if (parsed.success) return answered("POST /api/v1/upstream/categories", async () => ({ category: await createUpstreamCategory(parsed.data) }), 201);
  return createCategoryRoute(request("/api/v1/upstream/categories", { method: "POST", auth: await signedIn(), headers: json, body: JSON.stringify(body) }));
}

async function patch(id: string, body: Record<string, unknown>) {
  const parsed = UpstreamCategoryUpdateBody.safeParse(body);
  if (parsed.success) return answered("PATCH /api/v1/upstream/categories/{id}", async () => ({ category: await updateUpstreamCategory(id, parsed.data) }));
  return patchCategoryRoute(request(`/api/v1/upstream/categories/${id}`, { method: "PATCH", auth: await signedIn(), headers: json, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

const deleteCategory = (id: string) =>
  answered("DELETE /api/v1/upstream/categories/{id}", async () => {
    await deleteUpstreamCategory(id);
    return { ok: true };
  });

describe("upstream categories API", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureUpstreamCategories();
    await refreshResolverContexts();
  });

  it("lists seeded categories with their domains and a cost note", async () => {
    const video = await bySlug("video");
    expect(video.source).toBe("seed");
    expect(video.monogram).toBe("VID");
    expect(video.activeDomainCount).toBe(20);
    expect(video.costNote).toMatch(/A full pass takes about \d+s\./);
    expect(video.checks).toEqual([]);
    expect(effectiveCheck(video.checks)).toBeNull();
    expect(video.domains.every((domain) => domain.source === "seed")).toBe(true);
  });

  it("accepts a monogram of up to four characters and refuses five", async () => {
    const create = (monogram: string) =>
      createCategory({ label: `Mono ${monogram}`, monogram });
    const four = await create("abcd");
    expect(four.status).toBe(201);
    expect(((await four.json()) as { category: PublicCategory }).category.monogram).toBe("ABCD");
    expect((await create("abcde")).status).toBe(400);
  });

  it("creates a custom category, deriving the slug and monogram", async () => {
    const response = await createCategory({ label: "Homework Help", domains: ["https://chegg.com/study"] });
    expect(response.status).toBe(201);
    const { category } = (await response.json()) as { category: PublicCategory };
    expect(category.slug).toBe("homework-help");
    expect(category.monogram).toBe("HO");
    expect(category.source).toBe("user");
    // A pasted URL is reduced to its host rather than rejected.
    expect(category.domains.map((domain) => domain.domain)).toEqual(["chegg.com"]);
  });

  it("refuses a duplicate name", async () => {
    const response = await createCategory({ label: "Video" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("slug_taken");
  });

  it("strikes a seeded domain out of the list and restores it when included again", async () => {
    const video = await bySlug("video");
    const kept = video.domains.map((domain) => domain.domain).filter((domain) => domain !== "youtube.com");

    const struck = await patch(video.id, { domains: kept });
    expect(struck.status).toBe(200);
    let after = (await struck.json()).category as PublicCategory;
    let youtube = after.domains.find((domain) => domain.domain === "youtube.com");
    expect(youtube?.removed).toBe(true);
    expect(after.activeDomainCount).toBe(19);
    // Still on record, so it can come back.
    expect(after.domains).toHaveLength(20);

    const restored = await patch(video.id, {
      domains: after.domains.map((domain) => domain.domain),
    });
    expect(restored.status).toBe(200);
    after = (await restored.json()).category as PublicCategory;
    youtube = after.domains.find((domain) => domain.domain === "youtube.com");
    expect(youtube?.removed).toBe(false);
    expect(after.activeDomainCount).toBe(20);
  });

  it("deletes a customer-added domain outright rather than striking it", async () => {
    const video = await bySlug("video");
    const withAdded = await patch(video.id, {
      domains: [...video.domains.map((domain) => domain.domain), "mubi.com"],
    });
    expect(withAdded.status).toBe(200);
    const added = (await withAdded.json()).category as PublicCategory;
    expect(added.domains.find((domain) => domain.domain === "mubi.com")?.source).toBe("user");

    const removed = await patch(video.id, {
      domains: video.domains.map((domain) => domain.domain),
    });
    const after = (await removed.json()).category as PublicCategory;
    expect(after.domains.find((domain) => domain.domain === "mubi.com")).toBeUndefined();
    expect(after.domains).toHaveLength(20);
  });

  it("rejects a wildcard, a port and a bare word with a usable message", async () => {
    const video = await bySlug("video");
    const keep = video.domains.map((domain) => domain.domain);

    for (const bad of ["*.example.com", "example.com:8080", "notadomain"]) {
      const response = await patch(video.id, { domains: [...keep, bad] });
      expect(response.status, bad).toBe(400);
      const body = await response.json();
      expect(body.error.code, bad).toBe("invalid_domain");
      expect(body.error.message.length, bad).toBeGreaterThan(0);
    }
  });

  it("clears the last verdict when checking is turned off", async () => {
    const video = await bySlug("video");
    await prisma().upstreamCheck.create({
      data: {
        categoryId: video.id,
        verdict: UpstreamVerdict.partial,
        blockedCount: 6,
        totalCount: 20,
        results: [],
        durationMs: 800,
      },
    });

    const response = await patch(video.id, { enabled: false });
    expect(response.status).toBe(200);
    const after = (await response.json()).category as PublicCategory;
    expect(after.enabled).toBe(false);
    expect(effectiveCheck(after.checks)).toBeNull();
  });

  it("refuses to rename or delete a built-in category", async () => {
    const video = await bySlug("video");

    const renamed = await patch(video.id, { label: "Streaming" });
    expect(renamed.status).toBe(409);
    expect((await renamed.json()).error.code).toBe("seed_category");

    const removed = await deleteCategory(video.id);
    expect(removed.status).toBe(409);
    expect((await removed.json()).error.code).toBe("seed_category");
  });

  it("deletes a custom category and cascades its domains", async () => {
    const created = await prisma().upstreamCategory.create({
      data: {
        slug: "homework",
        label: "Homework",
        monogram: "HW",
        source: UpstreamSource.user,
        domains: { create: [{ domain: "chegg.com", source: UpstreamSource.user }] },
      },
    });

    const response = await deleteCategory(created.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await prisma().upstreamCategory.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await prisma().upstreamDomain.count({ where: { categoryId: created.id } })).toBe(0);
  });

  it("requires a session", async () => {
    const response = await getCategoryRoute(request("/api/v1/upstream/categories/whatever"), {
      params: Promise.resolve({ id: "whatever" }),
    });
    expect(response.status).toBe(401);
  });

  describe("per-domain results", () => {
    it("carries the sweep's own per-domain results through the check row", async () => {
      const created = await prisma().upstreamCategory.create({
        data: {
          slug: "homework", label: "Homework", monogram: "HW", source: UpstreamSource.user,
          domains: {
            create: [
              { domain: "chegg.com", source: UpstreamSource.user },
              { domain: "quizlet.com", source: UpstreamSource.user },
            ],
          },
        },
      });
      await prisma().upstreamCheck.create({
        data: {
          categoryId: created.id, groupId: null, verdict: UpstreamVerdict.partial,
          blockedCount: 1, totalCount: 2, durationMs: 5,
          results: [
            { domain: "chegg.com", blocked: true, rcode: 3 },
            { domain: "quizlet.com", blocked: false, rcode: 0 },
          ],
        },
      });

      const category = await bySlug("homework");
      const check = effectiveCheck(category.checks)!;
      expect(check.results).toEqual(
        expect.arrayContaining([
          { domain: "chegg.com", blocked: true },
          { domain: "quizlet.com", blocked: false },
        ]),
      );
    });

    it("drops a malformed results entry rather than throwing", async () => {
      const created = await prisma().upstreamCategory.create({
        data: {
          slug: "homework", label: "Homework", monogram: "HW", source: UpstreamSource.user,
          domains: { create: [{ domain: "chegg.com", source: UpstreamSource.user }] },
        },
      });
      await prisma().upstreamCheck.create({
        data: {
          categoryId: created.id, groupId: null, verdict: UpstreamVerdict.unknown,
          blockedCount: 0, totalCount: 1, durationMs: 5,
          // Not the shape probe.ts ever writes, but Json accepts anything.
          results: [{ domain: "chegg.com", blocked: "yes" }, "garbage", null],
        },
      });

      const category = await bySlug("homework");
      const check = effectiveCheck(category.checks)!;
      expect(check.results).toEqual([]);
    });

    /**
     * Removing a domain doesn't touch past checks — the sweep that recorded it as
     * blocked ran before the removal. `domainVerdict` has to notice the domain's own
     * `removed` flag, not just look the domain up in `results`.
     */
    it("reads a removed domain as unknown end to end, even with a stale blocked result", async () => {
      // A seed domain, not a user one: removing a user domain deletes the row
      // outright, but a seed domain is struck through (`removedAt` set) — the case
      // that leaves a stale check result sitting next to a `removed: true` row.
      const created = await prisma().upstreamCategory.create({
        data: {
          slug: "homework", label: "Homework", monogram: "HW", source: UpstreamSource.seed,
          domains: { create: [{ domain: "chegg.com", source: UpstreamSource.seed }] },
        },
      });
      await prisma().upstreamCheck.create({
        data: {
          categoryId: created.id, groupId: null, verdict: UpstreamVerdict.blocked,
          blockedCount: 1, totalCount: 1, durationMs: 5,
          results: [{ domain: "chegg.com", blocked: true, rcode: 3 }],
        },
      });

      await patch(created.id, { domains: [] });

      const category = await bySlug("homework");
      const chegg = category.domains.find((d) => d.domain === "chegg.com")!;
      expect(chegg.removed).toBe(true);
      expect(domainVerdict(chegg, effectiveCheck(category.checks))).toBe("unknown");
    });
  });
});
