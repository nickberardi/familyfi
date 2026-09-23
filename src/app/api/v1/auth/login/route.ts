import { NextResponse } from "next/server";
import { z } from "zod";
import { SessionKind } from "@prisma/client";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  authenticate,
  createSession,
  csrfCookieOptions,
  originAllowed,
  requestIsHttps,
  sessionCookieOptions,
  toPublicSession,
} from "@/server/auth";
import { clientIp, jsonCaughtError, jsonError } from "@/server/http";
import { authenticatePairedDevice } from "@/server/connection";
import { TUNNEL_HEADER } from "@/lib/constants";

const Body = z.object({
  username: z.string(),
  password: z.string(),
  client: z.enum(["browser", "native"]).optional(),
  deviceId: z.string().min(1).optional(),
  deviceCredential: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  if (!originAllowed(request)) {
    return jsonError(403, "forbidden_origin", "Request origin is not allowed.");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", "Username and password are required.");
  }

  try {
    const native = parsed.data.client === "native";
    const tunnelled = request.headers.get(TUNNEL_HEADER) === "tunnel";
    // Through remote access only a paired phone may sign in, and the phone is checked
    // before the password, so the internet cannot test passwords without one.
    if (tunnelled && !native) return jsonError(403, "remote_browser_login", "Sign in to the FamilyFi web app from the home network.");
    let device = tunnelled ? await pairedDevice(parsed.data) : null;
    if (tunnelled && !device) return jsonError(403, "device_not_paired", "Pair this phone with a household administrator before signing in.");

    const result = await authenticate(parsed.data.username, parsed.data.password, clientIp(request));
    if (!result.ok) return jsonError(result.status, result.code, result.message);

    if (native && !device) device = await pairedDevice(parsed.data);
    if (native && !device) return jsonError(403, "device_not_paired", "Pair this phone with a household administrator before signing in.");
    const issued = await createSession({
      accountId: result.account.id,
      username: result.account.username,
      kind: native ? SessionKind.bearer : SessionKind.cookie,
      userAgent: request.headers.get("user-agent"),
      deviceId: device?.id,
    });

    const body = {
      session: toPublicSession({
        username: result.account.username,
        expiresAt: issued.expiresAt,
        account: result.account,
      }),
      ...(native ? { token: issued.raw, tokenType: "Bearer" as const } : {}),
    };

    const response = NextResponse.json(body);
    if (!native) {
      const maxAge = Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000);
      const secure = requestIsHttps(request);
      response.cookies.set(SESSION_COOKIE, issued.raw, sessionCookieOptions(maxAge, secure));
      response.cookies.set(CSRF_COOKIE, issued.csrf, csrfCookieOptions(maxAge, secure));
    }
    return response;
  } catch (error) {
    return jsonCaughtError(error);
  }
}

function pairedDevice(body: { deviceId?: string; deviceCredential?: string }) {
  return body.deviceId && body.deviceCredential ? authenticatePairedDevice(body.deviceId, body.deviceCredential) : Promise.resolve(null);
}
