import { prisma } from "@/server/db";
import { withSession } from "@/server/guard";
import { jsonError } from "@/server/http";
import { normalizeMac } from "@/server/mac";
import { publicDevice, deviceScope } from "@/server/devices";

type Ctx = { params: Promise<{ mac: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { mac: raw } = await ctx.params;
    let mac: string;
    try {
      mac = normalizeMac(decodeURIComponent(raw));
    } catch {
      return jsonError(400, "invalid_mac", "MAC address must contain 12 hex digits.");
    }
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    const device = await prisma().device.findUnique({ where: { mac } });
    if (!device) return jsonError(404, "not_found", "Device not found.");
    return Response.json({ device: publicDevice(device, deviceScope(household)) });
  });
}
