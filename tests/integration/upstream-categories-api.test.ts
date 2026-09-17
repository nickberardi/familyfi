import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamSource, UpstreamVerdict } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/upstream/categories/route";
import {
  DELETE as deleteCategory,
  GET as getCategory,
  PATCH as patchCategory,
} from "@/app/api/v1/upstream/categories/[id]/route";
import { prisma } from "@/server/db";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
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
  check: { verdict: string; blockedCount: number; totalCount: number } | null;
};

async function categories(auth: Awaited<ReturnType<typeof signedIn>>) {
  const response = await listCategories(request("/api/v1/upstream/categories", { auth }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { categories: PublicCategory[] };
  return body.categories;
}

async function bySlug(auth: Awaited<ReturnType<typeof signedIn>>, slug: string) {
  const all = await categories(auth);
  const found = all.find((category) => category.slug === slug);
  expect(found, slug).toBeTruthy();
  return found!;
}

async function patch(
  auth: Awaited<ReturnType<typeof signedIn>>,
  id: string,
  body: Record<string, unknown>,
) {
  return patchCategory(
    request(`/api/v1/upstream/categories/${id}`, {
      method: "PATCH",
      auth,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("upstream categories API", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureUpstreamCategories();
  });

  it("lists seeded categories with their domains and a cost note", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");
    expect(video.source).toBe("seed");
    expect(video.monogram).toBe("VID");
    expect(video.activeDomainCount).toBe(20);
    expect(video.costNote).toMatch(/A full pass takes about \d+s\./);
    expect(video.check).toBeNull();
    expect(video.domains.every((domain) => domain.source === "seed")).toBe(true);
  });

  it("creates a custom category, deriving the slug and monogram", async () => {
    const auth = await signedIn();
    const response = await createCategory(
      request("/api/v1/upstream/categories", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Homework Help", domains: ["https://chegg.com/study"] }),
      }),
    );
    expect(response.status).toBe(201);
    const { category } = (await response.json()) as { category: PublicCategory };
    expect(category.slug).toBe("homework-help");
    expect(category.monogram).toBe("HO");
    expect(category.source).toBe("user");
    // A pasted URL is reduced to its host rather than rejected.
    expect(category.domains.map((domain) => domain.domain)).toEqual(["chegg.com"]);
  });

  it("refuses a duplicate name", async () => {
    const auth = await signedIn();
    const body = JSON.stringify({ label: "Video" });
    const response = await createCategory(
      request("/api/v1/upstream/categories", {
        method: "POST",
        auth,
        headers: { "content-type": "application/json" },
        body,
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("slug_taken");
  });

  it("strikes a seeded domain out of the list and restores it when included again", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");
    const kept = video.domains.map((domain) => domain.domain).filter((domain) => domain !== "youtube.com");

    const struck = await patch(auth, video.id, { domains: kept });
    expect(struck.status).toBe(200);
    let after = (await struck.json()).category as PublicCategory;
    let youtube = after.domains.find((domain) => domain.domain === "youtube.com");
    expect(youtube?.removed).toBe(true);
    expect(after.activeDomainCount).toBe(19);
    // Still on record, so it can come back.
    expect(after.domains).toHaveLength(20);

    const restored = await patch(auth, video.id, {
      domains: after.domains.map((domain) => domain.domain),
    });
    expect(restored.status).toBe(200);
    after = (await restored.json()).category as PublicCategory;
    youtube = after.domains.find((domain) => domain.domain === "youtube.com");
    expect(youtube?.removed).toBe(false);
    expect(after.activeDomainCount).toBe(20);
  });

  it("deletes a customer-added domain outright rather than striking it", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");
    const withAdded = await patch(auth, video.id, {
      domains: [...video.domains.map((domain) => domain.domain), "mubi.com"],
    });
    expect(withAdded.status).toBe(200);
    const added = (await withAdded.json()).category as PublicCategory;
    expect(added.domains.find((domain) => domain.domain === "mubi.com")?.source).toBe("user");

    const removed = await patch(auth, video.id, {
      domains: video.domains.map((domain) => domain.domain),
    });
    const after = (await removed.json()).category as PublicCategory;
    expect(after.domains.find((domain) => domain.domain === "mubi.com")).toBeUndefined();
    expect(after.domains).toHaveLength(20);
  });

  it("rejects a wildcard, a port and a bare word with a usable message", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");
    const keep = video.domains.map((domain) => domain.domain);

    for (const bad of ["*.example.com", "example.com:8080", "notadomain"]) {
      const response = await patch(auth, video.id, { domains: [...keep, bad] });
      expect(response.status, bad).toBe(400);
      const body = await response.json();
      expect(body.error.code, bad).toBe("invalid_domain");
      expect(body.error.message.length, bad).toBeGreaterThan(0);
    }
  });

  it("keeps the last verdict when checking is turned off", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");
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

    const response = await patch(auth, video.id, { enabled: false });
    expect(response.status).toBe(200);
    const after = (await response.json()).category as PublicCategory;
    expect(after.enabled).toBe(false);
    expect(after.check?.verdict).toBe("partial");
    expect(after.check?.blockedCount).toBe(6);
  });

  it("refuses to rename or delete a built-in category", async () => {
    const auth = await signedIn();
    const video = await bySlug(auth, "video");

    const renamed = await patch(auth, video.id, { label: "Streaming" });
    expect(renamed.status).toBe(409);
    expect((await renamed.json()).error.code).toBe("seed_category");

    const removed = await deleteCategory(
      request(`/api/v1/upstream/categories/${video.id}`, { method: "DELETE", auth }),
      { params: Promise.resolve({ id: video.id }) },
    );
    expect(removed.status).toBe(409);
    expect((await removed.json()).error.code).toBe("seed_category");
  });

  it("deletes a custom category and cascades its domains", async () => {
    const auth = await signedIn();
    const created = await prisma().upstreamCategory.create({
      data: {
        slug: "homework",
        label: "Homework",
        monogram: "HW",
        source: UpstreamSource.user,
        domains: { create: [{ domain: "chegg.com", source: UpstreamSource.user }] },
      },
    });

    const response = await deleteCategory(
      request(`/api/v1/upstream/categories/${created.id}`, { method: "DELETE", auth }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await prisma().upstreamCategory.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await prisma().upstreamDomain.count({ where: { categoryId: created.id } })).toBe(0);
  });

  it("requires a session", async () => {
    const response = await getCategory(request("/api/v1/upstream/categories/whatever"), {
      params: Promise.resolve({ id: "whatever" }),
    });
    expect(response.status).toBe(401);
  });
});
