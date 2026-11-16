import { z } from "zod";
import { readBody, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { testStoredUnifiConnection, testUnifiConnection } from "@/server/unifi-settings";
import { UnifiConfigError } from "@/server/unifi/errors";

const Body = z
  .object({
    apiKey: z.string().min(8).optional(),
    baseUrl: z.string().optional(),
    consoleId: z.string().optional(),
    siteId: z.string().optional(),
    tlsInsecure: z.boolean().optional(),
  })
  .refine((value) => !value.baseUrl || !value.consoleId, {
    message: "Provide baseUrl or consoleId, not both.",
  })
  .refine((value) => !value.apiKey || Boolean(value.baseUrl) !== Boolean(value.consoleId), {
    message: "Provide baseUrl or consoleId with a new API key.",
  });

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, Body, "Provide an API key and a UniFi target, or test the saved connection.");
    if (!parsed.ok) return parsed.response;
    try {
      const result = parsed.data.apiKey
        ? await testUnifiConnection({
            apiKey: parsed.data.apiKey,
            baseUrl: parsed.data.baseUrl,
            consoleId: parsed.data.consoleId,
            siteId: parsed.data.siteId,
            tlsInsecure: parsed.data.tlsInsecure,
          })
        : await testStoredUnifiConnection();
      return Response.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof UnifiConfigError || error instanceof Error ? error.message : "UniFi probe failed.";
      return jsonError(400, "unifi_invalid", message);
    }
  });
}
