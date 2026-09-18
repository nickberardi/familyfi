import { beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind, UpstreamSource, UpstreamVerdict } from "@prisma/client";
import { prisma } from "@/server/db";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { probeCategory, probeEnabledCategories } from "@/server/upstream/probe";
import type { DomainProbe } from "@/server/upstream/doh";
import { resetDatabase } from "../helpers/db";

const HOUSEHOLD_URL = "https://dns.example.com/dns-query/household";
const STRICT_URL = "https://strict.example.com/dns-query/kids";

async function setHouseholdResolver(url: string | null = HOUSEHOLD_URL) {
  await prisma().household.update({
    where: { id: "default" },
    data: { dohUrl: url, dohProbeEnabled: true },
  });
}

async function createGroup(name: string, dohOverrideUrl: string | null = null) {
  return prisma().group.create({
    data: { kind: GroupKind.family, name, familyRole: FamilyRole.child, dohOverrideUrl },
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

/** Answers per endpoint, so one sweep can model a split household. */
function perEndpointFetch(byUrl: Record<string, boolean>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    calls.push(target);
    const blocked = byUrl[target] ?? false;
    // Echo the query id — the resolver rejects a reply that does not match, which is
    // how a stale or mismatched answer is kept out of a verdict.
    const queryId = new DataView(new Uint8Array(init!.body as ArrayBuffer).buffer).getUint16(0);
    // Minimal wire-format reply: NXDOMAIN for blocked, one A record otherwise.
    const answers = blocked ? 0 : 1;
    const body = new Uint8Array(blocked ? 12 : 12 + 16);
    const view = new DataView(body.buffer);
    view.setUint16(0, queryId);
    view.setUint16(2, 0x8180 | (blocked ? 3 : 0));
    view.setUint16(6, answers);
    if (!blocked) {
      let o = 12;
      body[o++] = 0xc0;
      body[o++] = 0x0c;
      view.setUint16(o, 1);
      view.setUint16(o + 2, 1);
      view.setUint32(o + 4, 60);
      view.setUint16(o + 8, 4);
      body.set([93, 184, 216, 34], o + 10);
    }
    return new Response(body, { headers: { "content-type": "application/dns-message" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function categoryId(slug: string) {
  const category = await prisma().upstreamCategory.findUnique({ where: { slug }, select: { id: true } });
  expect(category, slug).toBeTruthy();
  return category!.id;
}

async function checkFor(categoryId: string, groupId: string | null) {
  return prisma().upstreamCheck.findFirst({ where: { categoryId, groupId } });
}

describe("upstream probe", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureUpstreamCategories();
    await setHouseholdResolver();
  });

  it("settles overlapping first checks with one row per resolver", async () => {
    const id = await categoryId("video");
    const group = await createGroup("Own resolver", STRICT_URL);
    const { fetchImpl } = perEndpointFetch({ [HOUSEHOLD_URL]: false, [STRICT_URL]: true });
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => probeCategory(id, { fetchImpl })));
    expect(outcomes.every((rows) => rows.length === 2)).toBe(true);
    expect(await prisma().upstreamCheck.count({ where: { categoryId: id } })).toBe(2);
    expect((await checkFor(id, null))?.verdict).toBe("open");
    expect((await checkFor(id, group.id))?.verdict).toBe("blocked");
  });

  it("records blocked when every domain is blocked", async () => {
    const id = await categoryId("adult");
    const [outcome] = await probeCategory(id, { resolve: stubResolver(() => true).resolve });

    expect(outcome!.verdict).toBe(UpstreamVerdict.blocked);
    expect(outcome!.blockedCount).toBe(20);
    expect(outcome!.groupId).toBeNull();
    const stored = await checkFor(id, null);
    expect(stored?.verdict).toBe(UpstreamVerdict.blocked);
    expect(stored?.error).toBeNull();
  });

  it("records partial and open", async () => {
    const socialId = await categoryId("social");
    const [partial] = await probeCategory(socialId, {
      resolve: stubResolver((domain) => domain === "facebook.com").resolve,
    });
    expect(partial!.verdict).toBe(UpstreamVerdict.partial);
    expect(partial!.blockedCount).toBe(1);

    const videoId = await categoryId("video");
    const [open] = await probeCategory(videoId, { resolve: stubResolver(() => false).resolve });
    expect(open!.verdict).toBe(UpstreamVerdict.open);
  });

  it("records unknown when a single domain cannot be observed", async () => {
    const id = await categoryId("video");
    const [outcome] = await probeCategory(id, {
      resolve: stubResolver((domain) => (domain === "netflix.com" ? null : true)).resolve,
    });

    expect(outcome!.verdict).toBe(UpstreamVerdict.unknown);
    expect((await checkFor(id, null))?.error).toContain("ECONNREFUSED");
  });

  /** The failure mode worth guarding: no endpoint must never read as "nothing is blocked". */
  it("records unknown, not open, when no endpoint is configured", async () => {
    await setHouseholdResolver(null);
    const id = await categoryId("adult");

    const [outcome] = await probeCategory(id);

    expect(outcome!.verdict).toBe(UpstreamVerdict.unknown);
    expect((await checkFor(id, null))?.error).toMatch(/endpoint/i);
  });

  it("does not query a struck-through domain but does query an added one", async () => {
    const id = await categoryId("video");
    await prisma().upstreamDomain.update({
      where: { categoryId_domain: { categoryId: id, domain: "youtube.com" } },
      data: { removedAt: new Date() },
    });
    await prisma().upstreamDomain.create({
      data: { categoryId: id, domain: "mubi.com", source: UpstreamSource.user },
    });
    const stub = stubResolver(() => true);

    const [outcome] = await probeCategory(id, { resolve: stub.resolve });

    expect(stub.asked).not.toContain("youtube.com");
    expect(stub.asked).toContain("mubi.com");
    expect(outcome!.totalCount).toBe(20);
  });

  it("skips a disabled category and leaves its last result standing", async () => {
    const videoId = await categoryId("video");
    await probeCategory(videoId, { resolve: stubResolver(() => true).resolve });
    await prisma().upstreamCategory.update({ where: { id: videoId }, data: { enabled: false } });

    const outcomes = await probeEnabledCategories({ resolve: stubResolver(() => false).resolve });

    expect(outcomes.some((outcome) => outcome.categoryId === videoId)).toBe(false);
    expect((await checkFor(videoId, null))?.verdict).toBe(UpstreamVerdict.blocked);
  });

  it("re-runs over an existing check rather than duplicating it", async () => {
    const id = await categoryId("video");
    await probeCategory(id, { resolve: stubResolver(() => true).resolve });
    await probeCategory(id, { resolve: stubResolver(() => false).resolve });

    expect(await prisma().upstreamCheck.count({ where: { categoryId: id } })).toBe(1);
    expect((await checkFor(id, null))?.verdict).toBe(UpstreamVerdict.open);
  });

  describe("a household split across resolvers", () => {
    /**
     * The case the whole per-group model exists for: one group pointed at a stricter
     * endpoint must get its own verdict, and the group without an override must keep
     * reading the household's. Reporting one answer for both would be wrong for
     * whichever group did not match.
     */
    it("gives the overridden group its own verdict and leaves the others on the household's", async () => {
      const betsy = await createGroup("Betsy", STRICT_URL);
      const nick = await createGroup("Nick");
      const id = await categoryId("adult");
      const { fetchImpl } = perEndpointFetch({ [STRICT_URL]: true, [HOUSEHOLD_URL]: false });

      const outcomes = await probeCategory(id, { fetchImpl, timeoutMs: 1000 });

      expect(outcomes).toHaveLength(2);
      expect((await checkFor(id, betsy.id))?.verdict).toBe(UpstreamVerdict.blocked);
      expect((await checkFor(id, null))?.verdict).toBe(UpstreamVerdict.open);
      // Nick has no override, so he has no row of his own — he reads the household's.
      expect(await checkFor(id, nick.id)).toBeNull();
    });

    it("sweeps a shared override once and writes a row for each group on it", async () => {
      const betsy = await createGroup("Betsy", STRICT_URL);
      const sam = await createGroup("Sam", STRICT_URL);
      const id = await categoryId("adult");
      const { fetchImpl, calls } = perEndpointFetch({ [STRICT_URL]: true, [HOUSEHOLD_URL]: false });

      await probeCategory(id, { fetchImpl, timeoutMs: 1000 });

      // Two endpoints, twenty domains each — not three sweeps for three consumers.
      expect(calls.filter((url) => url === STRICT_URL)).toHaveLength(20);
      expect(calls.filter((url) => url === HOUSEHOLD_URL)).toHaveLength(20);
      expect((await checkFor(id, betsy.id))?.verdict).toBe(UpstreamVerdict.blocked);
      expect((await checkFor(id, sam.id))?.verdict).toBe(UpstreamVerdict.blocked);
    });

    it("drops a group's verdict when the group is deleted", async () => {
      const betsy = await createGroup("Betsy", STRICT_URL);
      const id = await categoryId("adult");
      const { fetchImpl } = perEndpointFetch({ [STRICT_URL]: true, [HOUSEHOLD_URL]: false });
      await probeCategory(id, { fetchImpl, timeoutMs: 1000 });
      expect(await checkFor(id, betsy.id)).not.toBeNull();

      await prisma().group.delete({ where: { id: betsy.id } });

      expect(await checkFor(id, betsy.id)).toBeNull();
      expect(await checkFor(id, null)).not.toBeNull();
    });
  });

  it("sweeps every enabled category in one pass", async () => {
    const stub = stubResolver(() => true);
    const outcomes = await probeEnabledCategories({ resolve: stub.resolve });
    expect(outcomes).toHaveLength(9);
    expect(stub.asked).toHaveLength(179);
  });
});
