import { PairedDeviceClient } from "@prisma/client";
import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { prisma } from "@/server/db";
import { readJson } from "@/server/guard";
import { jsonError } from "@/server/http";
import { claimInvite } from "@/server/pairing";

const Body = z.object({ token: z.string().min(1), deviceName: z.string().trim().min(1).max(80) });
type Ctx = { params: Promise<{ id: string }> };

/** Joins with an invite's single-use code. Every client gets the same answer: its device, bearer and refresh token. */
export async function POST(request: Request, context: Ctx) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request", "The invite's token and a device name are required.");
  const { id } = await context.params;
  if (request.headers.get(TUNNEL_HEADER) === "tunnel") {
    const invite = await prisma().pairing.findUnique({ where: { id }, select: { client: true } });
    if (invite?.client === PairedDeviceClient.agent) return jsonError(403, "agent_remote", "Agents connect from the home network only.");
  }
  const claim = await claimInvite({ id, token: parsed.data.token, displayName: parsed.data.deviceName, userAgent: request.headers.get("user-agent") });
  if (!claim) return jsonError(403, "invalid_pairing", "This invite is invalid, expired, or already used.");
  return Response.json(claim);
}
