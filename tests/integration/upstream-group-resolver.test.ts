import { beforeEach, describe, expect, it } from "vitest";
import { UpstreamVerdict } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listGroups } from "@/app/api/v1/groups/route";
import {
  DELETE as clearResolver,
  PUT as setResolver,
} from "@/app/api/v1/groups/[id]/resolver/route";
import { prisma } from "@/server/db";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { effectiveCheck, type UpstreamCheckRow } from "@/lib/upstream";
import { authFromLogin, request } from "../helpers/http";
import { createFamilyGroup, resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const STRICT_URL = "https://strict.example.com/dns-query/kids";

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

type PublicGroup = { id: string; name: string; dohOverrideUrl: string | null };

async function groups(auth: Awaited<ReturnType<typeof signedIn>>) {
  const response = await listGroups(request("/api/v1/groups", { auth }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { groups: PublicGroup[] }).groups;
}

function put(auth: Awaited<ReturnType<typeof signedIn>>, id: string, body: unknown) {
  return setResolver(
    request(`/api/v1/groups/${id}/resolver`, {
      method: "PUT",
      auth,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

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
    const auth = await signedIn();
    const betsy = await createFamilyGroup("Betsy");

    expect((await groups(auth)).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBeNull();

    const saved = await put(auth, betsy.id, { url: STRICT_URL });
    expect(saved.status).toBe(200);
    expect((await groups(auth)).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBe(STRICT_URL);

    const cleared = await clearResolver(
      request(`/api/v1/groups/${betsy.id}/resolver`, { method: "DELETE", auth }),
      { params: Promise.resolve({ id: betsy.id }) },
    );
    expect(cleared.status).toBe(200);
    expect((await groups(auth)).find((g) => g.id === betsy.id)?.dohOverrideUrl).toBeNull();
  });

  /**
   * A verdict measured through an endpoint the group no longer uses is worse than no
   * verdict: the card would keep showing it, confidently, until the next sweep.
   */
  it("drops the group's own verdicts when the override is removed", async () => {
    const auth = await signedIn();
    const betsy = await createFamilyGroup("Betsy");
    await put(auth, betsy.id, { url: STRICT_URL });
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

    await clearResolver(request(`/api/v1/groups/${betsy.id}/resolver`, { method: "DELETE", auth }), {
      params: Promise.resolve({ id: betsy.id }),
    });

    expect(await prisma().upstreamCheck.count({ where: { groupId: betsy.id } })).toBe(0);
    // The household row is untouched, and Betsy now reads it.
    const household = await prisma().upstreamCheck.findFirst({
      where: { categoryId: category.id, groupId: null },
    });
    expect(household?.verdict).toBe(UpstreamVerdict.open);
  });

  it("resolves each card against its own endpoint", async () => {
    const auth = await signedIn();
    const betsy = await createFamilyGroup("Betsy");
    const nick = await createFamilyGroup("Nick");
    await put(auth, betsy.id, { url: STRICT_URL });
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
    const all = await groups(auth);
    const betsyCard = all.find((g) => g.id === betsy.id)!;
    const nickCard = all.find((g) => g.id === nick.id)!;

    // Same page, same category, two different answers — each card's own.
    expect(effectiveCheck(rows, betsyCard)?.verdict).toBe(UpstreamVerdict.blocked);
    expect(effectiveCheck(rows, nickCard)?.verdict).toBe(UpstreamVerdict.open);
  });

  it("rejects a non-https endpoint and an unknown group", async () => {
    const auth = await signedIn();
    const betsy = await createFamilyGroup("Betsy");

    const plain = await put(auth, betsy.id, { url: "http://dns.example.com/dns-query" });
    expect(plain.status).toBe(400);
    expect((await plain.json()).error.code).toBe("invalid_resolver");

    const missing = await put(auth, "nope", { url: STRICT_URL });
    expect(missing.status).toBe(404);
  });

  it("requires a session", async () => {
    const response = await setResolver(
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
