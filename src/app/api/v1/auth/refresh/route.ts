import { z } from "zod";
import { originAllowed, refreshSession, toPublicSession } from "@/server/auth";
import { jsonCaughtError, jsonError } from "@/server/http";

const Body = z.object({ refreshToken: z.string().min(1) });

/** A paired device trades its refresh token for a new access token and refresh token. */
export async function POST(request: Request) {
  if (!originAllowed(request)) return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return jsonError(400, "invalid_request", "A refresh token is required.");
  try {
    const result = await refreshSession(parsed.data.refreshToken);
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
