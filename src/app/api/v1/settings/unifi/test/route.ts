import { z } from "zod";
import { readJson, withMutation } from "@/server/guard";
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
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide an API key and a UniFi target, or test the saved connection.");
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
