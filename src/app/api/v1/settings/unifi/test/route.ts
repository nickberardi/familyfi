import { z } from "zod";
import { readJson, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { testUnifiConnection } from "@/server/unifi-settings";
import { UnifiConfigError } from "@/server/unifi/errors";

const Body = z
  .object({
    apiKey: z.string().min(8),
    baseUrl: z.string().optional(),
    consoleId: z.string().optional(),
    siteId: z.string().optional(),
    tlsInsecure: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.baseUrl) !== Boolean(value.consoleId), {
    message: "Provide baseUrl or consoleId, not both.",
  });

export async function POST(request: Request) {
  return withMutation(request, async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Provide an API key and a UniFi target.");
    try {
      const result = await testUnifiConnection(parsed.data);
      return Response.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof UnifiConfigError || error instanceof Error ? error.message : "UniFi probe failed.";
      return jsonError(400, "unifi_invalid", message);
    }
  });
}
