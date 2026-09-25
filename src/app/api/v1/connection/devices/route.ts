import { PairedDeviceClient, SessionKind } from "@prisma/client";
import { z } from "zod";
import { enrollWatch, removeRevokedDevices } from "@/server/connection";
import { prisma } from "@/server/db";
import { jsonError } from "@/server/http";
import { readJson, withAdmin, withMutation } from "@/server/guard";

const Enrollment = z.object({ client: z.literal("watch"), clientId: z.string().uuid(), displayName: z.string().trim().min(1).max(80).optional() });

function pairedVia(endpoint: { id: string; url: string; transport: string } | null) {
  return endpoint ? { endpointId: endpoint.id, url: endpoint.url, transport: endpoint.transport } : null;
}

export async function GET(request: Request) {
  return withAdmin(request, async () => {
    const devices = await prisma().pairedDevice.findMany({ orderBy: { lastSeenAt: "desc" }, include: { pairings: { include: { endpoint: true }, take: 1 }, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, username: true, expiresAt: true, createdAt: true } } } });
    return Response.json({ devices: devices.map((device) => ({ id: device.id, displayName: device.displayName, client: device.client, enrolledAt: device.createdAt.toISOString(), lastSeenAt: device.lastSeenAt?.toISOString() ?? null, revokedAt: device.revokedAt?.toISOString() ?? null, pairedVia: pairedVia(device.pairings[0]?.endpoint ?? null), sessions: device.sessions.map((session) => ({ id: session.id, username: session.username, client: device.client, expiresAt: session.expiresAt.toISOString(), createdAt: session.createdAt.toISOString() })) })) });
  });
}

export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    if (session.kind !== SessionKind.bearer || session.device?.client !== PairedDeviceClient.phone || !session.accountId) {
      return jsonError(403, "paired_phone_required", "A signed-in paired phone is required to enroll a Watch.");
    }
    const body = await readJson(request);
    if (!body.ok) return body.response;
    const parsed = Enrollment.safeParse(body.value);
    if (!parsed.success) return jsonError(400, "invalid_request", "A Watch identifier and optional name are required.");
    const enrolled = await enrollWatch({
      clientId: parsed.data.clientId,
      accountId: session.accountId,
      username: session.username,
      displayName: parsed.data.displayName ?? "Apple Watch",
    });
    return Response.json(enrolled, { status: 201 });
  });
}

/** `?revoked=true` removes every revoked phone's record. Active phones are never touched. */
export async function DELETE(request: Request) {
  return withAdmin(request, async () => {
    if (new URL(request.url).searchParams.get("revoked") !== "true") {
      return jsonError(400, "invalid_request", "Only revoked phones can be removed in bulk: add ?revoked=true.");
    }
    return Response.json({ removed: await removeRevokedDevices() });
  });
}
