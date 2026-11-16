import { z } from "zod";
import { readBody, withMutation } from "@/server/guard";
import { tryUnifiConnection } from "@/server/unifi-settings";

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
    return Response.json({ ok: true, ...(await tryUnifiConnection(parsed.data)) });
  });
}
