import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

// `/openapi` checks its own session, which may be an agent's bearer rather than a cookie. `/setup`
// checks its own too: it opens before sign-in only while the household has no gateway.
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/api\/v1\/health$/, /^\/api\/v1\/auth\/login$/, /^\/agents\.md$/, /^\/openapi$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((pattern) => pattern.test(pathname))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname === "/manifest.webmanifest") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// A request the proxy sees has its body buffered, and past Next's 10 MB limit only the first part
// reaches the route, with no error. A household import is up to 50 MB and the proxy does nothing for
// `/api/` anyway, so that one route skips it; raising the limit would let anyone make every route
// buffer 50 MB before any check.
export const config = {
  matcher: ["/((?!_next/static|_next/image|api/v1/settings/import$).*)"],
};
