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
import { clientIp, jsonError } from "@/server/http";

const Body = z.object({
  username: z.string(),
  password: z.string(),
  client: z.enum(["browser", "native"]).optional(),
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

  const result = await authenticate(parsed.data.username, parsed.data.password, clientIp(request));
  if (!result.ok) return jsonError(result.status, result.code, result.message);

  const native = parsed.data.client === "native";
  const issued = await createSession({
    accountId: result.account.id,
    username: result.account.username,
    kind: native ? SessionKind.bearer : SessionKind.cookie,
    userAgent: request.headers.get("user-agent"),
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
}
