import { z } from "zod";
import { TUNNEL_HEADER } from "@/lib/constants";
import { originAllowed, refreshSession, toPublicSession } from "@/server/auth";
import { readBody } from "@/server/guard";
import { jsonCaughtError, jsonError } from "@/server/http";

const Body = z.object({ refreshToken: z.string().min(1) });

/** A paired device trades its refresh token for a new access token and refresh token. */
export async function POST(request: Request) {
  if (!originAllowed(request)) return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  const parsed = await readBody(request, Body, "A refresh token is required.");
  if (!parsed.ok) return parsed.response;
  try {
    const result = await refreshSession(parsed.data.refreshToken, { tunnelled: request.headers.get(TUNNEL_HEADER) === "tunnel" });
    if (!result.ok) return jsonError(403, result.code, result.message);
    return Response.json({
      session: toPublicSession(result.session),
      token: result.token,
      tokenType: "Bearer",
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt.toISOString(),
    });
  } catch (error) {
    return jsonCaughtError(error);
  }
}
