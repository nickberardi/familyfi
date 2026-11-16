import { Prisma } from "@prisma/client";
import { parseHm } from "@/lib/schedule";
import { prisma } from "../db";
import { ApiError } from "../http";
import { DEFAULT_WEEKLY_DAYS, DEFAULT_WEEKLY_TIME, nextWeeklyRunAt } from "../weekly-schedule";
import { refreshResolverContexts, type ResolverContext } from "./discovery";
import { ResolverConfigError, normalizeResolverUrl } from "./resolver-settings";
import { rescheduleUpstreamProbe } from "./schedule";
import { withUpstreamLock } from "./transaction";

const SELECT = {
  dohUrl: true,
  dohProbeEnabled: true,
  dohProbeTime: true,
  dohProbeDays: true,
  dohProbeLastRunAt: true,
  dohProbeTimeoutMs: true,
  timezone: true,
} as const;

function serialize(household: {
  dohUrl: string | null;
  dohProbeEnabled: boolean;
  dohProbeTime: string;
  dohProbeDays: number[];
  dohProbeLastRunAt: Date | null;
  dohProbeTimeoutMs: number;
  timezone: string;
}, context: ResolverContext) {
  const probeTime = household.dohProbeTime ?? DEFAULT_WEEKLY_TIME;
  const probeDays = household.dohProbeDays ?? DEFAULT_WEEKLY_DAYS;
  return {
    configured: context.source !== "unknown" && !context.reason,
    url: household.dohUrl ?? null,
    source: context.source,
    networks: context.networks,
    reason: context.reason,
    probeEnabled: household.dohProbeEnabled,
    probeTime,
    probeDays,
    timeoutMs: household.dohProbeTimeoutMs ?? 5000,
    lastRunAt: household.dohProbeLastRunAt?.toISOString() ?? null,
    nextRunAt:
      household.dohProbeEnabled && probeDays.length > 0
        ? nextWeeklyRunAt(new Date(), household.timezone, probeTime, probeDays).toISOString()
        : null,
  };
}

/**
 * The household DNS-over-HTTPS endpoint, returned in full. It is configuration rather
 * than a credential, and an operator who mistyped a profile id needs to be able to see
 * that rather than stare at a mask while every category reports unknown.
 */
export async function getHouseholdResolver() {
  const context = (await refreshResolverContexts()).household;
  const household = await prisma().household.findUnique({ where: { id: "default" }, select: SELECT });
  return serialize(
    household ?? {
      dohUrl: null,
      dohProbeEnabled: false,
      dohProbeTime: DEFAULT_WEEKLY_TIME,
      dohProbeDays: DEFAULT_WEEKLY_DAYS,
      dohProbeLastRunAt: null,
      dohProbeTimeoutMs: 5000,
      timezone: "America/New_York",
    },
    context,
  );
}

export async function setHouseholdResolver(input: { url?: string; probeEnabled?: boolean; probeTime?: string; probeDays?: number[]; timeoutMs?: number }) {
  let url: string | undefined;
  if (input.url !== undefined) {
    try {
      url = normalizeResolverUrl(input.url);
    } catch (error) {
      if (error instanceof ResolverConfigError) throw new ApiError(400, "invalid_resolver", error.message);
      throw error;
    }
  }
  if (input.probeTime !== undefined) {
    try {
      parseHm(input.probeTime);
    } catch {
      throw new ApiError(400, "invalid_probe_time", "Times must be HH:MM in 24-hour form.");
    }
  }

  const household = await withUpstreamLock(async (tx) => {
    const existing = await tx.household.findUniqueOrThrow({ where: { id: "default" } });
    if (url !== undefined && url !== existing.dohUrl) {
      await tx.upstreamCheck.deleteMany({ where: { groupId: null } });
    }
    if (input.probeEnabled === false) await tx.upstreamCheck.deleteMany();
    return tx.household.update({
      where: { id: "default" },
      data: {
        ...(url !== undefined ? { dohUrl: url } : {}),
        ...(url !== undefined && url !== existing.dohUrl ? { upstreamResolverSnapshot: Prisma.DbNull } : {}),
        ...(input.probeEnabled !== undefined ? { dohProbeEnabled: input.probeEnabled } : {}),
        ...(input.probeEnabled === false ? { dohProbeDisabledAt: new Date() } : {}),
        ...(input.probeTime !== undefined ? { dohProbeTime: input.probeTime } : {}),
        ...(input.probeDays !== undefined ? { dohProbeDays: input.probeDays } : {}),
        ...(input.timeoutMs !== undefined ? { dohProbeTimeoutMs: input.timeoutMs } : {}),
      },
      select: SELECT,
    });
  });
  rescheduleUpstreamProbe();
  const context = (await refreshResolverContexts()).household;
  return serialize(household, context);
}

/** Removing a DoH override returns to DHCP discovery without changing the check schedule. */
export async function clearHouseholdResolver() {
  await withUpstreamLock(async (tx) => {
    await tx.upstreamCheck.deleteMany({ where: { groupId: null } });
    await tx.household.update({
      where: { id: "default" },
      data: { dohUrl: null, upstreamResolverSnapshot: Prisma.DbNull },
    });
  });
  await refreshResolverContexts();
  rescheduleUpstreamProbe();
}
