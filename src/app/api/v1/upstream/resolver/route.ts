import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { parseHm } from "@/lib/schedule";
import { ResolverConfigError, normalizeResolverUrl } from "@/server/upstream/resolver-settings";
import { DEFAULT_PROBE_DAYS, DEFAULT_PROBE_TIME, nextProbeRunAt, rescheduleUpstreamProbe } from "@/server/upstream/schedule";
import { withUpstreamLock } from "@/server/upstream/transaction";
import { refreshResolverContexts, type ResolverContext } from "@/server/upstream/discovery";
import { demoLocked } from "@/server/demo";

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
  const probeTime = household.dohProbeTime ?? DEFAULT_PROBE_TIME;
  const probeDays = household.dohProbeDays ?? DEFAULT_PROBE_DAYS;
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
        ? nextProbeRunAt(new Date(), household.timezone, probeTime, probeDays).toISOString()
        : null,
  };
}

/**
 * The household DNS-over-HTTPS endpoint, returned in full. It is configuration rather
 * than a credential, and an operator who mistyped a profile id needs to be able to see
 * that rather than stare at a mask while every category reports unknown.
 */
export async function GET(request: Request) {
  return withSession(request, async () => {
    const context = (await refreshResolverContexts()).household;
    const household = await prisma().household.findUnique({ where: { id: "default" }, select: SELECT });
    return Response.json({
      resolver: serialize(
        household ?? {
          dohUrl: null,
          dohProbeEnabled: false,
          dohProbeTime: DEFAULT_PROBE_TIME,
          dohProbeDays: DEFAULT_PROBE_DAYS,
          dohProbeLastRunAt: null,
          dohProbeTimeoutMs: 5000,
          timezone: "America/New_York",
        },
        context,
      ),
    });
  });
}

const PutBody = z.object({
  url: z.string().min(1).optional(),
  probeEnabled: z.boolean().optional(),
  probeTime: z.string().optional(),
  probeDays: z.array(z.number().int().min(0).max(6)).optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
});

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = PutBody.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Invalid resolver settings.");

    let url: string | undefined;
    if (parsed.data.url !== undefined) {
      try {
        url = normalizeResolverUrl(parsed.data.url);
      } catch (error) {
        if (error instanceof ResolverConfigError) {
          return jsonError(400, "invalid_resolver", error.message);
        }
        throw error;
      }
    }
    if (parsed.data.probeTime !== undefined) {
      try {
        parseHm(parsed.data.probeTime);
      } catch {
        return jsonError(400, "invalid_probe_time", "Times must be HH:MM in 24-hour form.");
      }
    }

    const household = await withUpstreamLock(async (tx) => {
      const existing = await tx.household.findUniqueOrThrow({ where: { id: "default" } });
      if (url !== undefined && url !== existing.dohUrl) {
        await tx.upstreamCheck.deleteMany({ where: { groupId: null } });
      }
      if (parsed.data.probeEnabled === false) await tx.upstreamCheck.deleteMany();
      return tx.household.update({
        where: { id: "default" },
        data: {
          ...(url !== undefined ? { dohUrl: url } : {}),
          ...(url !== undefined && url !== existing.dohUrl ? { upstreamResolverSnapshot: Prisma.DbNull } : {}),
          ...(parsed.data.probeEnabled !== undefined ? { dohProbeEnabled: parsed.data.probeEnabled } : {}),
          ...(parsed.data.probeEnabled === false ? { dohProbeDisabledAt: new Date() } : {}),
          ...(parsed.data.probeTime !== undefined ? { dohProbeTime: parsed.data.probeTime } : {}),
          ...(parsed.data.probeDays !== undefined ? { dohProbeDays: parsed.data.probeDays } : {}),
          ...(parsed.data.timeoutMs !== undefined ? { dohProbeTimeoutMs: parsed.data.timeoutMs } : {}),
        },
        select: SELECT,
      });
    });
    rescheduleUpstreamProbe();
    const context = (await refreshResolverContexts()).household;
    return Response.json({ resolver: serialize(household, context) });
  });
}

/** Removing a DoH override returns to DHCP discovery without changing the check schedule. */
export async function DELETE(request: Request) {
  return withMutation(request, async () => {
    const locked = demoLocked();
    if (locked) return locked;
    await withUpstreamLock(async (tx) => {
      await tx.upstreamCheck.deleteMany({ where: { groupId: null } });
      await tx.household.update({
        where: { id: "default" },
        data: { dohUrl: null, upstreamResolverSnapshot: Prisma.DbNull },
      });
    });
    await refreshResolverContexts();
    rescheduleUpstreamProbe();
    return Response.json({ ok: true });
  });
}
