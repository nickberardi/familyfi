import { deviceMac, forgetDevice, getDevice } from "@/server/devices";
import { withMutation, withSession } from "@/server/guard";

type Ctx = { params: Promise<{ mac: string }> };

export async function GET(request: Request, ctx: Ctx) {
  return withSession(request, async () => {
    const { mac } = await ctx.params;
    return Response.json({ device: await getDevice(deviceMac(mac)) });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { mac } = await ctx.params;
    const { change } = await forgetDevice(deviceMac(mac));
    return Response.json({ ok: true, change });
  });
}
