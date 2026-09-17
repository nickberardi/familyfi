import { z } from "zod";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { ResolverConfigError, normalizeResolverUrl } from "@/server/upstream/resolver-settings";

/**
 * The household DNS-over-HTTPS endpoint, returned in full. It is configuration rather
 * than a credential, and an operator who mistyped a profile id needs to be able to see
 * that rather than stare at a mask while every category reports unknown.
 */
export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { dohUrl: true, dohProbeEnabled: true, dohProbeIntervalMinutes: true, dohProbeTimeoutMs: true },
    });
    return Response.json({
      resolver: {
        configured: Boolean(household?.dohUrl),
        url: household?.dohUrl ?? null,
        probeEnabled: household?.dohProbeEnabled ?? false,
        intervalMinutes: household?.dohProbeIntervalMinutes ?? 1440,
        timeoutMs: household?.dohProbeTimeoutMs ?? 5000,
      },
    });
  });
}

const PutBody = z.object({
  url: z.string().min(1).optional(),
  probeEnabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(1).max(10080).optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
});

export async function PUT(request: Request) {
  return withMutation(request, async () => {
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

    const household = await prisma().household.update({
      where: { id: "default" },
      data: {
        ...(url !== undefined ? { dohUrl: url } : {}),
        ...(parsed.data.probeEnabled !== undefined ? { dohProbeEnabled: parsed.data.probeEnabled } : {}),
        ...(parsed.data.intervalMinutes !== undefined
          ? { dohProbeIntervalMinutes: parsed.data.intervalMinutes }
          : {}),
        ...(parsed.data.timeoutMs !== undefined ? { dohProbeTimeoutMs: parsed.data.timeoutMs } : {}),
      },
      select: { dohUrl: true, dohProbeEnabled: true, dohProbeIntervalMinutes: true, dohProbeTimeoutMs: true },
    });
    return Response.json({
      resolver: {
        configured: Boolean(household.dohUrl),
        url: household.dohUrl,
        probeEnabled: household.dohProbeEnabled,
        intervalMinutes: household.dohProbeIntervalMinutes,
        timeoutMs: household.dohProbeTimeoutMs,
      },
    });
  });
}

/** Clearing the endpoint turns every verdict unknown on the next sweep, never open. */
export async function DELETE(request: Request) {
  return withMutation(request, async () => {
    await prisma().household.update({
      where: { id: "default" },
      data: { dohUrl: null, dohProbeEnabled: false },
    });
    return Response.json({ ok: true });
  });
}
