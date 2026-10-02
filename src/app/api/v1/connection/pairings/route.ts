import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { requestOrigin } from "@/server/auth";
import { createAgentPairing, createPairing } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson, withAdmin } from "@/server/guard";

const AgentBody = z.object({ client: z.literal("agent"), deviceName: z.string().trim().min(1).max(80), grant: z.enum(["read", "controls"]) });
const Body = z.object({ endpointId: z.string().min(1), deviceName: z.string().trim().min(1).max(80), replacesDeviceId: z.string().min(1).optional() });

export async function POST(request: Request) {
  return withAdmin(request, async (session) => {
    const body = await readJson(request);
    if (!body.ok) return body.response;
    if (body.value && typeof body.value === "object" && "client" in body.value && body.value.client === "agent") {
      const agent = AgentBody.safeParse(body.value);
      if (!agent.success) return jsonError(400, "invalid_request", "An agent's name and grant (read or controls) are required.");
      // The code carries the address it was made at, so it must be one an agent at home can reach.
      if (request.headers.get(TUNNEL_HEADER) === "tunnel") return jsonError(403, "agent_remote", "Connect an agent from the FamilyFi web app on the home network.");
      if (!session.accountId) return jsonError(403, "administrator_required", "Sign in with a personal account to connect an agent.");
      const { pairing, pairingCode } = await createAgentPairing({ url: requestOrigin(request), displayName: agent.data.deviceName, grant: agent.data.grant, createdByAccountId: session.accountId });
      return Response.json({ pairing: { id: pairing.id, expiresAt: pairing.expiresAt.toISOString(), pairingCode } }, { status: 201 });
    }
    const parsed = Body.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "Endpoint and phone name are required.");
    const endpoint = await prisma().connectionEndpoint.findFirst({ where: { id: parsed.data.endpointId, householdId: "default", enabled: true } });
    if (!endpoint || !session.accountId) return jsonError(404, "not_found", "Connection endpoint not found.");
    if (parsed.data.replacesDeviceId && !(await prisma().pairedDevice.findUnique({ where: { id: parsed.data.replacesDeviceId } }))) {
      return jsonError(404, "not_found", "The phone to re-pair no longer exists.");
    }
    const { pairing, pairingCode } = await createPairing({ endpointId: endpoint.id, displayName: parsed.data.deviceName, createdByAccountId: session.accountId, replacesDeviceId: parsed.data.replacesDeviceId });
    return Response.json({ pairing: { id: pairing.id, expiresAt: pairing.expiresAt.toISOString(), pairingCode } }, { status: 201 });
  });
}
