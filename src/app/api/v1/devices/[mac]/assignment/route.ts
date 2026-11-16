import { AssignmentState } from "@prisma/client";
import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { publicDevice, deviceScope } from "@/server/devices";
import { prisma } from "@/server/db";
import { readBody, withMutation } from "@/server/guard";
import { jsonError } from "@/server/http";
import { normalizeMac } from "@/server/mac";
import { loadHousehold } from "@/server/household";

const Body = z.object({
  groupId: z.string().nullable(),
});

type Ctx = { params: Promise<{ mac: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async () => {
    const { mac: raw } = await ctx.params;
    let mac: string;
    try {
      mac = normalizeMac(decodeURIComponent(raw));
    } catch {
      return jsonError(400, "invalid_mac", "MAC address must contain 12 hex digits.");
    }
    const parsed = await readBody(request, Body, "groupId is required (null for quarantine).");
    if (!parsed.ok) return parsed.response;
    const existing = await prisma().device.findUnique({ where: { mac } });
    if (!existing) return jsonError(404, "not_found", "Device not found.");
    if (parsed.data.groupId) {
      const group = await prisma().group.findUnique({ where: { id: parsed.data.groupId } });
      if (!group) return jsonError(404, "not_found", "Group not found.");
    }
    const device = await prisma().device.update({
      where: { mac },
      data: {
        groupId: parsed.data.groupId,
        assignment: parsed.data.groupId ? AssignmentState.assigned : AssignmentState.quarantined,
      },
    });
    const change = await enqueueChange("assignment", mac);
    const household = await loadHousehold();
    return Response.json({ device: publicDevice(device, deviceScope(household), new Date(), household.presenceCheckedAt), change });
  });
}
