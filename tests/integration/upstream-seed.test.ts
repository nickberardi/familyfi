import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamSource } from "@prisma/client";
import { UPSTREAM_CATEGORY_DOMAINS, UPSTREAM_SEED_CATEGORIES } from "@/lib/upstream-domains";
import { prisma } from "@/server/db";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { resetDatabase } from "../helpers/db";

async function categoryBySlug(slug: string) {
  return prisma().upstreamCategory.findUnique({
    where: { slug },
    include: { domains: true },
  });
}

describe("upstream seed reconcile", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("seeds every shipped category and its domains", async () => {
    await ensureUpstreamCategories();

    const categories = await prisma().upstreamCategory.findMany();
    expect(categories).toHaveLength(UPSTREAM_SEED_CATEGORIES.length);
    expect(categories.every((category) => category.source === UpstreamSource.seed)).toBe(true);

    const video = await categoryBySlug("video");
    expect(video?.label).toBe("Video");
    expect(video?.monogram).toBe("VID");
    expect(video?.domains).toHaveLength(UPSTREAM_CATEGORY_DOMAINS.video.length);
    expect(video?.domains.every((domain) => domain.source === UpstreamSource.seed)).toBe(true);
    expect(video?.domains.every((domain) => domain.removedAt === null)).toBe(true);
  });

  it("is idempotent across boots", async () => {
    await ensureUpstreamCategories();
    const before = await prisma().upstreamDomain.count();
    const stamps = await prisma().upstreamCategory.findMany({
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    });

    await ensureUpstreamCategories();

    expect(await prisma().upstreamDomain.count()).toBe(before);
    expect(await prisma().upstreamCategory.count()).toBe(UPSTREAM_SEED_CATEGORIES.length);
    const after = await prisma().upstreamCategory.findMany({
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    });
    expect(after.map((row) => row.slug)).toEqual(stamps.map((row) => row.slug));
  });

  /** A release that adds a canary must reach a household that already ran the seed. */
  it("delivers a newly shipped domain on the next boot", async () => {
    await ensureUpstreamCategories();
    const video = await categoryBySlug("video");
    await prisma().upstreamDomain.delete({
      where: { categoryId_domain: { categoryId: video!.id, domain: "netflix.com" } },
    });

    await ensureUpstreamCategories();

    const reseeded = await categoryBySlug("video");
    const netflix = reseeded?.domains.find((domain) => domain.domain === "netflix.com");
    expect(netflix).toBeTruthy();
    expect(netflix?.source).toBe(UpstreamSource.seed);
    expect(netflix?.removedAt).toBeNull();
  });

  /** The requirement most likely to regress: a removal is a decision, not a gap to refill. */
  it("keeps a removed seed domain removed across boots", async () => {
    await ensureUpstreamCategories();
    const video = await categoryBySlug("video");
    await prisma().upstreamDomain.update({
      where: { categoryId_domain: { categoryId: video!.id, domain: "youtube.com" } },
      data: { removedAt: new Date() },
    });

    await ensureUpstreamCategories();

    const reseeded = await categoryBySlug("video");
    const youtube = reseeded?.domains.find((domain) => domain.domain === "youtube.com");
    expect(youtube?.removedAt).not.toBeNull();
    expect(reseeded?.domains).toHaveLength(UPSTREAM_CATEGORY_DOMAINS.video.length);
  });

  it("never touches a custom category or a customer-added domain", async () => {
    await ensureUpstreamCategories();
    const custom = await prisma().upstreamCategory.create({
      data: { slug: "homework", label: "Homework", monogram: "HW", source: UpstreamSource.user },
    });
    await prisma().upstreamDomain.create({
      data: { categoryId: custom.id, domain: "chegg.com", source: UpstreamSource.user },
    });
    const video = await categoryBySlug("video");
    await prisma().upstreamDomain.create({
      data: { categoryId: video!.id, domain: "mubi.com", source: UpstreamSource.user },
    });

    await ensureUpstreamCategories();

    const stillThere = await categoryBySlug("homework");
    expect(stillThere?.source).toBe(UpstreamSource.user);
    expect(stillThere?.label).toBe("Homework");
    expect(stillThere?.domains.map((domain) => domain.domain)).toEqual(["chegg.com"]);

    const reseeded = await categoryBySlug("video");
    const added = reseeded?.domains.find((domain) => domain.domain === "mubi.com");
    expect(added?.source).toBe(UpstreamSource.user);
    expect(added?.removedAt).toBeNull();
  });

  /** Retiring a canary should not delete a domain a household may now depend on. */
  it("leaves a domain that has left the shipped seed in place", async () => {
    await ensureUpstreamCategories();
    const video = await categoryBySlug("video");
    await prisma().upstreamDomain.create({
      data: { categoryId: video!.id, domain: "retired.example", source: UpstreamSource.seed },
    });

    await ensureUpstreamCategories();

    const reseeded = await categoryBySlug("video");
    expect(reseeded?.domains.map((domain) => domain.domain)).toContain("retired.example");
  });

  it("follows the seed for label and monogram after a release renames a category", async () => {
    await ensureUpstreamCategories();
    const video = await categoryBySlug("video");
    await prisma().upstreamCategory.update({
      where: { id: video!.id },
      data: { label: "Stale", monogram: "ZZ" },
    });

    await ensureUpstreamCategories();

    const reseeded = await categoryBySlug("video");
    expect(reseeded?.label).toBe("Video");
    expect(reseeded?.monogram).toBe("VID");
  });
});
