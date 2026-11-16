import { z } from "zod";
import { assignDevice, deviceMac } from "@/server/devices";
import { readBody, withMutation } from "@/server/guard";

const Body = z.object({
  groupId: z.string().nullable(),
});

type Ctx = { params: Promise<{ mac: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const mac = deviceMac((await ctx.params).mac);
    const parsed = await readBody(request, Body, "groupId is required (null for quarantine).");
    if (!parsed.ok) return parsed.response;
    return Response.json(await assignDevice(mac, parsed.data.groupId));
  });
}
