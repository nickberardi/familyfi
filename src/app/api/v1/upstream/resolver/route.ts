import { z } from "zod";
import { prisma } from "@/server/db";
import { readJson, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { ResolverConfigError, encryptResolverUrl } from "@/server/upstream/resolver-settings";

/**
 * The household DNS-over-HTTPS endpoint. The URL itself is never returned — a
 * NextDNS path carries the profile id, which is bearer-ish — so reads get the mask
 * and writes are replace-only, the same shape as the UniFi API key.
 */
export async function GET(request: Request) {
  return withSession(request, async () => {
    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { dohUrlMask: true, dohProbeEnabled: true, dohProbeIntervalMinutes: true, dohProbeTimeoutMs: true },
    });
    return Response.json({
      resolver: {
        configured: Boolean(household?.dohUrlMask),
        mask: household?.dohUrlMask ?? null,
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

    let secret: ReturnType<typeof encryptResolverUrl> | undefined;
    if (parsed.data.url !== undefined) {
      try {
        secret = encryptResolverUrl(parsed.data.url);
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
        ...(secret
          ? {
              dohUrlCiphertext: secret.ciphertext,
              dohUrlIv: secret.iv,
              dohUrlAuthTag: secret.authTag,
              dohUrlMask: secret.mask,
            }
          : {}),
        ...(parsed.data.probeEnabled !== undefined ? { dohProbeEnabled: parsed.data.probeEnabled } : {}),
        ...(parsed.data.intervalMinutes !== undefined
          ? { dohProbeIntervalMinutes: parsed.data.intervalMinutes }
          : {}),
        ...(parsed.data.timeoutMs !== undefined ? { dohProbeTimeoutMs: parsed.data.timeoutMs } : {}),
      },
      select: { dohUrlMask: true, dohProbeEnabled: true, dohProbeIntervalMinutes: true, dohProbeTimeoutMs: true },
    });
    return Response.json({
      resolver: {
        configured: Boolean(household.dohUrlMask),
        mask: household.dohUrlMask,
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
      data: {
        dohUrlCiphertext: null,
        dohUrlIv: null,
        dohUrlAuthTag: null,
        dohUrlMask: null,
        dohProbeEnabled: false,
      },
    });
    return Response.json({ ok: true });
  });
}
