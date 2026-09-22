import { z } from "zod";
import { claimPairing } from "@/server/connection";
import { jsonError } from "@/server/http";
import { readJson } from "@/server/guard";

const Body = z.object({ token: z.string().min(1), deviceName: z.string().trim().min(1).max(80) });
type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = Body.safeParse(body.value);
  if (!parsed.success) return jsonError(400, "invalid_request", "Pairing token and phone name are required.");
  const { id } = await context.params;
  const result = await claimPairing({ id, token: parsed.data.token, displayName: parsed.data.deviceName });
  if (!result) return jsonError(403, "invalid_pairing", "Pairing code is invalid, expired, or already used.");
  return Response.json({ device: { id: result.device.id, displayName: result.device.displayName }, deviceCredential: result.credential, endpoint: result.endpoint, manifest: result.manifest });
}
