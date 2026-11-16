import { z } from "zod";
import { readBody, withMutation, withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { listSiteNetworks, publicUnifiSettings, saveManagedNetworks, saveUnifiConnection } from "@/server/unifi-settings";
import { PreviousTargetError, UnifiConfigError } from "@/server/unifi/errors";
import { loadHousehold } from "@/server/household";

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
  return withSession(request, async () => {
    const household = await loadHousehold();
    let networks: Awaited<ReturnType<typeof listSiteNetworks>> = [];
    if (household.unifiKeyLastFour) {
      try {
        networks = await listSiteNetworks(household);
      } catch {
        networks = [];
      }
    }
    return Response.json({ unifi: publicUnifiSettings(household, networks) });
  });
}

export async function PUT(request: Request) {
  return withMutation(request, async () => {
    const parsed = await readBody(request, UnifiBody, "Provide an API key and UniFi target, or a managed network selection.");
    if (!parsed.ok) return parsed.response;
    try {
      const change = parsed.data.apiKey
        ? await saveUnifiConnection({
            apiKey: parsed.data.apiKey,
            baseUrl: parsed.data.baseUrl,
            consoleId: parsed.data.consoleId,
            siteId: parsed.data.siteId,
            tlsInsecure: parsed.data.tlsInsecure,
            manageAllNetworks: parsed.data.manageAllNetworks,
            managedNetworkIds: parsed.data.managedNetworkIds,
            forgetPrevious: parsed.data.forgetPrevious,
          })
        : await saveManagedNetworks({
            manageAllNetworks: parsed.data.manageAllNetworks,
            managedNetworkIds: parsed.data.managedNetworkIds,
          });
      const household = await loadHousehold();
      let networks: Awaited<ReturnType<typeof listSiteNetworks>> = [];
      try {
        networks = await listSiteNetworks(household);
      } catch {
        networks = [];
      }
      return Response.json({ unifi: publicUnifiSettings(household, networks), change });
    } catch (error) {
      if (error instanceof PreviousTargetError) return jsonError(409, "previous_gateway_unreachable", error.message);
      const message = error instanceof UnifiConfigError || error instanceof Error ? error.message : "UniFi probe failed.";
      return jsonError(400, "unifi_invalid", message);
    }
  }, { demoLock: true });
}
