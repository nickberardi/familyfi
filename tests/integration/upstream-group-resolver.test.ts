import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamVerdict } from "@prisma/client";
import { PUT as setResolverRoute } from "@/app/api/v1/groups/[id]/resolver/route";
import { prisma } from "@/server/db";
import { listGroups } from "@/server/groups";
import { clearGroupResolver, getGroupResolver, setGroupResolver } from "@/server/upstream/group-resolver";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { effectiveCheck, type UpstreamCheckRow } from "@/lib/upstream";
import { request } from "../helpers/http";
import { createFamilyGroup, resetDatabase } from "../helpers/db";
import { refusal } from "../helpers/refusal";

const STRICT_URL = "https://strict.example.com/dns-query/kids";

describe("group resolver override", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureUpstreamCategories();
    await prisma().household.update({
      where: { id: "default" },
      data: { dohUrl: "https://dns.example.com/dns-query/household" },
    });
  });

  it("sets and clears an override, and reports it on the group", async () => {
    const betsy = await createFamilyGroup("Betsy");

    expect((await listGroups()).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBeNull();

    expect((await setGroupResolver(betsy.id, STRICT_URL)).dohOverrideUrl).toBe(STRICT_URL);
    expect((await listGroups()).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBe(STRICT_URL);
    expect(await getGroupResolver(betsy.id)).toMatchObject({ source: "doh", url: STRICT_URL, networks: [] });

    expect((await clearGroupResolver(betsy.id)).dohOverrideUrl).toBeNull();
    expect((await listGroups()).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBeNull();
  });

  /**
   * A verdict measured through an endpoint the group no longer uses is worse than no
   * verdict: the card would keep showing it, confidently, until the next sweep.
   */
  it("drops the group's own verdicts when the override is removed", async () => {
    const betsy = await createFamilyGroup("Betsy");
    await setGroupResolver(betsy.id, STRICT_URL);
    const category = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: "adult" } });
    await prisma().upstreamCheck.createMany({
      data: [
        {
          categoryId: category.id,
          groupId: betsy.id,
          verdict: UpstreamVerdict.blocked,
          blockedCount: 20,
          totalCount: 20,
          results: [],
          durationMs: 10,
        },
        {
          categoryId: category.id,
          groupId: null,
          verdict: UpstreamVerdict.open,
          blockedCount: 0,
          totalCount: 20,
          results: [],
          durationMs: 10,
        },
      ],
    });

    await clearGroupResolver(betsy.id);

    expect(await prisma().upstreamCheck.count({ where: { groupId: betsy.id } })).toBe(0);
    // The household row is untouched, and Betsy now reads it.
    const household = await prisma().upstreamCheck.findFirst({
      where: { categoryId: category.id, groupId: null },
    });
    expect(household?.verdict).toBe(UpstreamVerdict.open);
  });

  it("resolves each card against its own endpoint", async () => {
    const betsy = await createFamilyGroup("Betsy");
    const nick = await createFamilyGroup("Nick");
    await setGroupResolver(betsy.id, STRICT_URL);
    const category = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: "adult" } });
    await prisma().upstreamCheck.createMany({
      data: [
        {
          categoryId: category.id,
          groupId: betsy.id,
          verdict: UpstreamVerdict.blocked,
          blockedCount: 20,
          totalCount: 20,
          results: [],
          durationMs: 10,
        },
        {
          categoryId: category.id,
          groupId: null,
          verdict: UpstreamVerdict.open,
          blockedCount: 0,
          totalCount: 20,
          results: [],
          durationMs: 10,
        },
      ],
    });

    const rows = (await prisma().upstreamCheck.findMany({ where: { categoryId: category.id } })).map(
      (row): UpstreamCheckRow => ({
        verdict: row.verdict,
        blockedCount: row.blockedCount,
        totalCount: row.totalCount,
        checkedAt: row.checkedAt.toISOString(),
        error: row.error,
        groupId: row.groupId,
        results: [],
      }),
    );
    const all = await listGroups();
    const betsyCard = all.find((g) => g.id === betsy.id)!;
    const nickCard = all.find((g) => g.id === nick.id)!;

    // Same page, same category, two different answers — each card's own.
    expect(effectiveCheck(rows, betsyCard)?.verdict).toBe(UpstreamVerdict.blocked);
    expect(effectiveCheck(rows, nickCard)?.verdict).toBe(UpstreamVerdict.open);
  });

  it("rejects a non-https endpoint and an unknown group", async () => {
    const betsy = await createFamilyGroup("Betsy");

    expect(await refusal(setGroupResolver(betsy.id, "http://dns.example.com/dns-query"))).toEqual([400, "invalid_resolver"]);
    expect(await refusal(setGroupResolver("nope", STRICT_URL))).toEqual([404, "not_found"]);
    expect(await refusal(getGroupResolver("nope"))).toEqual([404, "not_found"]);
    expect(await refusal(clearGroupResolver("nope"))).toEqual([404, "not_found"]);
  });

  it("requires a session", async () => {
    const response = await setResolverRoute(
      request("/api/v1/groups/whatever/resolver", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: STRICT_URL }),
      }),
      { params: Promise.resolve({ id: "whatever" }) },
    );
    expect(response.status).toBe(401);
  });
});
