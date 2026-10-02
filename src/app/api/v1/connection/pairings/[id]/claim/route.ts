import { PairedDeviceClient } from "@prisma/client";
import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { toPublicSession } from "@/server/auth";
import { claimAgentPairing, claimPairing } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson } from "@/server/guard";

const Body = z.object({ token: z.string().min(1), deviceName: z.string().trim().min(1).max(80) });
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request", "Pairing token and device name are required.");
  const { id } = await context.params;

  const pairing = await prisma().pairing.findUnique({ where: { id }, select: { client: true } });
  if (pairing?.client === PairedDeviceClient.agent) {
    if (request.headers.get(TUNNEL_HEADER) === "tunnel") return jsonError(403, "agent_remote", "Agents connect from the home network only.");
    const agent = await claimAgentPairing({ id, token: parsed.data.token, displayName: parsed.data.deviceName, userAgent: request.headers.get("user-agent") });
    if (!agent) return jsonError(403, "invalid_pairing", "Pairing code is invalid, expired, or already used.");
    return Response.json({
      device: { id: agent.device.id, displayName: agent.device.displayName, grant: agent.device.agentGrant },
      session: toPublicSession({ username: agent.account.username, expiresAt: agent.expiresAt, account: agent.account }),
      token: agent.token,
      tokenType: "Bearer",
      refreshToken: agent.refreshToken,
      refreshExpiresAt: agent.refreshExpiresAt.toISOString(),
    });
  }

  const result = await claimPairing({ id, token: parsed.data.token, displayName: parsed.data.deviceName });
  if (!result) return jsonError(403, "invalid_pairing", "Pairing code is invalid, expired, or already used.");
  return Response.json({ device: { id: result.device.id, displayName: result.device.displayName }, deviceCredential: result.credential, endpoint: result.endpoint, manifest: result.manifest });
}
