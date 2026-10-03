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
import { TUNNEL_HEADER } from "@/lib/constants";

/** Sign-in is for people in a browser. Phones, Watches and agents join by pairing (`/paired/invites`). */
const Body = z.object({
  username: z.string(),
  password: z.string(),
  client: z.literal("browser").optional(),
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
    // A paired device signs in by pairing, never here. Through remote access nobody signs in here,
    // so the internet cannot test passwords.
    if (request.headers.get(TUNNEL_HEADER) === "tunnel") return jsonError(403, "remote_browser_login", "Sign in to the FamilyFi web app from the home network.");

    const result = await authenticate(parsed.data.username, parsed.data.password, clientIp(request));
    if (!result.ok) return jsonError(result.status, result.code, result.message);

    const issued = await createSession({
      accountId: result.account.id,
      username: result.account.username,
      kind: SessionKind.cookie,
      userAgent: request.headers.get("user-agent"),
    });

    const response = NextResponse.json({
      session: toPublicSession({ username: result.account.username, expiresAt: issued.expiresAt, account: result.account }),
    });
    const maxAge = Math.floor((issued.expiresAt.getTime() - Date.now()) / 1000);
    const secure = requestIsHttps(request);
    response.cookies.set(SESSION_COOKIE, issued.raw, sessionCookieOptions(maxAge, secure));
    response.cookies.set(CSRF_COOKIE, issued.csrf, csrfCookieOptions(maxAge, secure));
    return response;
  } catch (error) {
    return jsonCaughtError(error);
  }
}
