import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { AppVersion } from "@/server/device-token";
import { readBody } from "@/server/guard";
import { jsonError } from "@/server/http";
import { claimInviteFrom } from "@/server/pairing";

/** `appVersion` is optional while apps before 2.0, which never send it, still pair. */
const Body = z.object({ token: z.string().min(1), deviceName: z.string().trim().min(1).max(80), appVersion: AppVersion.optional() });
type Ctx = { params: Promise<{ id: string }> };

/** Joins with an invite's single-use code. Every client gets the same answer: its device, bearer and refresh token. */
export async function POST(request: Request, context: Ctx) {
  const parsed = await readBody(request, Body, "The invite's token and a device name are required.");
  if (!parsed.ok) return parsed.response;
  const { id } = await context.params;
  const joined = await claimInviteFrom({
    id,
    token: parsed.data.token,
    displayName: parsed.data.deviceName,
    appVersion: parsed.data.appVersion,
    userAgent: request.headers.get("user-agent"),
    tunnelled: request.headers.get(TUNNEL_HEADER) === "tunnel",
  });
  if (!joined.ok) return jsonError(joined.status, joined.code, joined.message);
  return Response.json(joined.claim);
}
