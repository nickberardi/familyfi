import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamSource, UpstreamVerdict } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { probeCategory, probeEnabledCategories } from "@/server/upstream/probe";
import { encryptResolverUrl } from "@/server/upstream/resolver-settings";
import type { DomainProbe } from "@/server/upstream/doh";
import { resetDatabase } from "../helpers/db";

async function setHouseholdResolver(url = "https://dns.example.com/dns-query/profile") {
  const secret = encryptResolverUrl(url);
  await prisma().household.update({
    where: { id: "default" },
    data: {
      dohUrlCiphertext: secret.ciphertext,
      dohUrlIv: secret.iv,
      dohUrlAuthTag: secret.authTag,
      dohUrlMask: secret.mask,
      dohProbeEnabled: true,
    },
  });
}

/** A resolver that answers from a fixed verdict per domain. */
function stubResolver(answer: (domain: string) => boolean | null) {
  const asked: string[] = [];
  const resolve = async (domain: string): Promise<DomainProbe> => {
    asked.push(domain);
    const blocked = answer(domain);
    return {
      domain,
      blocked,
      rcode: blocked === true ? 3 : blocked === false ? 0 : null,
      answers: blocked === false ? ["93.184.216.34"] : [],
      ...(blocked === null ? { error: "ECONNREFUSED" } : {}),
    };
  };
  return { resolve, asked };
}

async function categoryId(slug: string) {
  const category = await prisma().upstreamCategory.findUnique({ where: { slug }, select: { id: true } });
  expect(category, slug).toBeTruthy();
  return category!.id;
}

describe("upstream probe", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureUpstreamCategories();
    await setHouseholdResolver();
  });

  it("records blocked when every domain is blocked", async () => {
    const id = await categoryId("adult");
    const stub = stubResolver(() => true);

    const outcome = await probeCategory(id, { resolve: stub.resolve });

    expect(outcome.verdict).toBe(UpstreamVerdict.blocked);
    expect(outcome.blockedCount).toBe(20);
    expect(outcome.totalCount).toBe(20);
    const stored = await prisma().upstreamCheck.findUnique({ where: { categoryId: id } });
    expect(stored?.verdict).toBe(UpstreamVerdict.blocked);
    expect(stored?.durationMs).toBeGreaterThanOrEqual(0);
    expect(stored?.error).toBeNull();
  });

  it("records partial and open", async () => {
    const socialId = await categoryId("social");
    const partial = stubResolver((domain) => domain === "facebook.com");
    const partialOutcome = await probeCategory(socialId, { resolve: partial.resolve });
    expect(partialOutcome.verdict).toBe(UpstreamVerdict.partial);
    expect(partialOutcome.blockedCount).toBe(1);

    const videoId = await categoryId("video");
    const open = stubResolver(() => false);
    const openOutcome = await probeCategory(videoId, { resolve: open.resolve });
    expect(openOutcome.verdict).toBe(UpstreamVerdict.open);
    expect(openOutcome.blockedCount).toBe(0);
  });

  it("records unknown when a single domain cannot be observed", async () => {
    const id = await categoryId("video");
    const stub = stubResolver((domain) => (domain === "netflix.com" ? null : true));

    const outcome = await probeCategory(id, { resolve: stub.resolve });

    expect(outcome.verdict).toBe(UpstreamVerdict.unknown);
    const stored = await prisma().upstreamCheck.findUnique({ where: { categoryId: id } });
    expect(stored?.error).toContain("ECONNREFUSED");
  });

  /** The failure mode worth guarding: no endpoint must never read as "nothing is blocked". */
  it("records unknown, not open, when no endpoint is configured", async () => {
    await prisma().household.update({
      where: { id: "default" },
      data: { dohUrlCiphertext: null, dohUrlIv: null, dohUrlAuthTag: null, dohUrlMask: null },
    });
    const id = await categoryId("adult");

    const outcome = await probeCategory(id);

    expect(outcome.verdict).toBe(UpstreamVerdict.unknown);
    expect(outcome.blockedCount).toBe(0);
    const stored = await prisma().upstreamCheck.findUnique({ where: { categoryId: id } });
    expect(stored?.error).toMatch(/endpoint/i);
  });

  it("does not query a struck-through domain", async () => {
    const id = await categoryId("video");
    await prisma().upstreamDomain.update({
      where: { categoryId_domain: { categoryId: id, domain: "youtube.com" } },
      data: { removedAt: new Date() },
    });
    const stub = stubResolver(() => true);

    const outcome = await probeCategory(id, { resolve: stub.resolve });

    expect(stub.asked).not.toContain("youtube.com");
    expect(outcome.totalCount).toBe(19);
  });

  it("queries a customer-added domain", async () => {
    const id = await categoryId("video");
    await prisma().upstreamDomain.create({
      data: { categoryId: id, domain: "mubi.com", source: UpstreamSource.user },
    });
    const stub = stubResolver(() => true);

    await probeCategory(id, { resolve: stub.resolve });

    expect(stub.asked).toContain("mubi.com");
  });

  it("skips a disabled category and leaves its last result standing", async () => {
    const videoId = await categoryId("video");
    const blocked = stubResolver(() => true);
    await probeCategory(videoId, { resolve: blocked.resolve });
    await prisma().upstreamCategory.update({ where: { id: videoId }, data: { enabled: false } });

    const open = stubResolver(() => false);
    const outcomes = await probeEnabledCategories({ resolve: open.resolve });

    expect(outcomes.some((outcome) => outcome.categoryId === videoId)).toBe(false);
    const stored = await prisma().upstreamCheck.findUnique({ where: { categoryId: videoId } });
    expect(stored?.verdict).toBe(UpstreamVerdict.blocked);
  });

  it("re-runs over an existing check rather than duplicating it", async () => {
    const id = await categoryId("video");
    await probeCategory(id, { resolve: stubResolver(() => true).resolve });
    const first = await prisma().upstreamCheck.findUnique({ where: { categoryId: id } });

    await probeCategory(id, { resolve: stubResolver(() => false).resolve });

    expect(await prisma().upstreamCheck.count({ where: { categoryId: id } })).toBe(1);
    const second = await prisma().upstreamCheck.findUnique({ where: { categoryId: id } });
    expect(second?.verdict).toBe(UpstreamVerdict.open);
    expect(second?.checkedAt.getTime()).toBeGreaterThanOrEqual(first!.checkedAt.getTime());
  });

  it("sweeps every enabled category in one pass", async () => {
    const stub = stubResolver(() => true);
    const outcomes = await probeEnabledCategories({ resolve: stub.resolve });
    expect(outcomes).toHaveLength(9);
    expect(outcomes.every((outcome) => outcome.verdict === UpstreamVerdict.blocked)).toBe(true);
    expect(stub.asked).toHaveLength(179);
  });
});
