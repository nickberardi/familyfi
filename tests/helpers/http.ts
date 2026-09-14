import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@/lib/constants";
import { cookieValue } from "@/lib/cookie";
import { TEST_ORIGIN } from "./test-env";

export type SessionAuth = {
  cookie: string;
  csrf: string;
  token?: string;
};

function setCookies(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

export function authFromLogin(response: Response, token?: string): SessionAuth {
  const parts = setCookies(response);
  const header = parts.join("; ");
  const session = cookieValue(header, SESSION_COOKIE);
  const csrf = cookieValue(header, CSRF_COOKIE);
  if (token) return { cookie: "", csrf: "", token };
  if (!session || !csrf) throw new Error("login did not set session and CSRF cookies");
  return { cookie: `${SESSION_COOKIE}=${session}; ${CSRF_COOKIE}=${csrf}`, csrf };
}

export function apiHeaders(auth: SessionAuth, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("origin", TEST_ORIGIN);
  headers.set("host", "familyfi.test");
  if (auth.token) headers.set("authorization", `Bearer ${auth.token}`);
  else {
    headers.set("cookie", auth.cookie);
    headers.set(CSRF_HEADER, auth.csrf);
  }
  return headers;
}

export function request(path: string, init: RequestInit & { auth?: SessionAuth } = {}): Request {
  const { auth, headers: extra, ...rest } = init;
  const headers = auth ? apiHeaders(auth, extra) : new Headers(extra);
  if (!headers.has("origin")) {
    headers.set("origin", TEST_ORIGIN);
    headers.set("host", "familyfi.test");
  }
  return new Request(`${TEST_ORIGIN}${path}`, { ...rest, headers });
}
