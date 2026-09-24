import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamSource } from "@prisma/client";
import { prisma } from "@/server/db";
import { dueProbeRunAt, runProbeCatchUpForTests, stopUpstreamProbeForTests } from "@/server/upstream/schedule";
import { resetDatabase } from "../helpers/db";

const RESOLVER_URL = "https://dns.example.com/dns-query/household";

async function setHousehold(data: {
  dohProbeEnabled?: boolean;
  dohProbeTime?: string;
  dohProbeDays?: number[];
  dohProbeLastRunAt?: Date | null;
}) {
  return prisma().household.update({
    where: { id: "default" },
    data: { dohUrl: RESOLVER_URL, ...data },
  });
}

/** Any enabled category with one domain, so a sweep has something to probe. */
async function seedCategory() {
  return prisma().upstreamCategory.create({
    data: {
      slug: "test", label: "Test", monogram: "T", source: UpstreamSource.user, enabled: true,
      domains: { create: { domain: "example.com", source: UpstreamSource.user } },
    },
  });
}

/** Today's weekday (0 Sunday–6 Saturday) as the household's default timezone sees it. */
function todayInNewYork(): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(
    new Date(),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

describe("upstream probe schedule", () => {
  beforeEach(resetDatabase);

  it("claims and sweeps when the scheduled instant has passed with no run recorded", async () => {
    await seedCategory();
    await setHousehold({ dohProbeEnabled: true, dohProbeTime: "00:00", dohProbeLastRunAt: null });
    const expectedDue = dueProbeRunAt(new Date(), "America/New_York", "00:00", [0, 1, 2, 3, 4, 5, 6]);
    const claimed = await runProbeCatchUpForTests();
    expect(claimed).toBe(true);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.dohProbeLastRunAt?.getTime()).toBe(expectedDue.getTime());
    const checks = await prisma().upstreamCheck.findMany();
    expect(checks.length).toBeGreaterThan(0);
    stopUpstreamProbeForTests();
  });

  it("does not claim again once the due instant is already recorded", async () => {
    await seedCategory();
    const now = new Date();
    await setHousehold({ dohProbeEnabled: true, dohProbeTime: "00:00", dohProbeLastRunAt: now });
    const claimed = await runProbeCatchUpForTests();
    expect(claimed).toBe(false);
    stopUpstreamProbeForTests();
  });

  it("leaves exactly one winner across concurrent claims", async () => {
    await seedCategory();
    await setHousehold({ dohProbeEnabled: true, dohProbeTime: "00:00", dohProbeLastRunAt: null });
    const results = await Promise.all([
      runProbeCatchUpForTests(),
      runProbeCatchUpForTests(),
      runProbeCatchUpForTests(),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    stopUpstreamProbeForTests();
  });

  it("does not start a second sweep while one is still running", async () => {
    await seedCategory();
    await setHousehold({ dohProbeEnabled: true, dohProbeTime: "00:00", dohProbeLastRunAt: null });
    // Hold the first sweep inside its DNS request until the second run has been claimed.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inFlight!: () => void;
    const firstRequest = new Promise<void>((resolve) => (inFlight = resolve));
    const fetchStub = vi.fn(async () => {
      inFlight();
      await gate;
      throw new Error("resolver offline");
    });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const first = runProbeCatchUpForTests();
      await firstRequest;
      const requests = fetchStub.mock.calls.length;
      // A later instant falls due mid-sweep: it is claimed, but no second sweep starts.
      await setHousehold({ dohProbeLastRunAt: null });
      expect(await runProbeCatchUpForTests()).toBe(true);
      expect(fetchStub).toHaveBeenCalledTimes(requests);
      release();
      expect(await first).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      stopUpstreamProbeForTests();
    }
  });

  it("never claims while checking is disabled", async () => {
    await seedCategory();
    await setHousehold({ dohProbeEnabled: false, dohProbeTime: "00:00", dohProbeLastRunAt: null });
    const claimed = await runProbeCatchUpForTests();
    expect(claimed).toBe(false);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.dohProbeLastRunAt).toBeNull();
    stopUpstreamProbeForTests();
  });

  it("does not advance the claim for a day excluded from the schedule", async () => {
    await seedCategory();
    const everyDayButToday = [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== todayInNewYork());
    // Already caught up through the most recent scheduled day (today excluded), so
    // today passing local midnight must not, by itself, trigger another claim.
    const alreadyDue = dueProbeRunAt(new Date(), "America/New_York", "00:00", everyDayButToday);
    await setHousehold({
      dohProbeEnabled: true,
      dohProbeTime: "00:00",
      dohProbeDays: everyDayButToday,
      dohProbeLastRunAt: alreadyDue,
    });
    const claimed = await runProbeCatchUpForTests();
    expect(claimed).toBe(false);
    stopUpstreamProbeForTests();
  });
});
