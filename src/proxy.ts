import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

const PUBLIC = [/^\/login$/, /^\/api\/v1\/health$/, /^\/api\/v1\/auth\/login$/];

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

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
