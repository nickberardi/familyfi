import { NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  requestIsHttps,
  requireCsrf,
  revokeSession,
  sessionCookieOptions,
} from "@/server/auth";
import { jsonCaughtError } from "@/server/http";

export async function POST(request: Request) {
  try {
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;
    await revokeSession(request);
    const response = NextResponse.json({ ok: true });
    const secure = requestIsHttps(request);
    response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0, secure), maxAge: 0 });
    response.cookies.set(CSRF_COOKIE, "", { ...sessionCookieOptions(0, secure), httpOnly: false, maxAge: 0 });
    return response;
  } catch (error) {
    return jsonCaughtError(error);
  }
}
