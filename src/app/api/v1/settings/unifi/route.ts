import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { getUnifiSettings, updateUnifiSettings } from "@/server/unifi-settings";

const UnifiBody = z
  .object({
    apiKey: z.string().min(8).optional(),
    baseUrl: z.string().optional(),
    consoleId: z.string().optional(),
    siteId: z.string().optional(),
    tlsInsecure: z.boolean().optional(),
    manageAllNetworks: z.boolean().optional(),
    managedNetworkIds: z.array(z.string().min(1)).optional(),
    forgetPrevious: z.boolean().optional(),
  })
  .refine((value) => !value.baseUrl || !value.consoleId, {
    message: "Provide baseUrl or consoleId, not both.",
  })
  .refine((value) => Boolean(value.apiKey) || value.manageAllNetworks !== undefined || value.managedNetworkIds !== undefined, {
    message: "Provide an API key or a network selection.",
  })
  .refine((value) => !value.apiKey || Boolean(value.baseUrl) !== Boolean(value.consoleId), {
    message: "Provide baseUrl or consoleId, not both.",
  });

export async function GET(request: Request) {
  return withSession(request, async () => Response.json({ unifi: await getUnifiSettings() }));
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, UnifiBody, "Provide an API key and UniFi target, or a managed network selection.");
    if (!parsed.ok) return parsed.response;
    return Response.json(await updateUnifiSettings(parsed.data));
  }, { demoLock: true });
}
