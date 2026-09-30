import { ApiError, waitForChange as pollChange, type ApiRequest } from "./api-client";
import { CSRF_COOKIE, CSRF_HEADER } from "./constants";

export { ApiError };

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") headers.set(CSRF_HEADER, csrfToken());
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  let json: { error?: { code?: string; message?: string } } | null = null;
  try {
    json = (await response.json()) as { error?: { code?: string; message?: string } };
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new ApiError(json?.error?.message ?? "Request failed.", response.status, json?.error?.code);
  }
  return json as T;
}

/** `api` as the shared store and writes call it: a JSON body, serialized here. */
export const request: ApiRequest = (path, init = {}) =>
  api(path, { method: init.method, body: init.body === undefined ? undefined : JSON.stringify(init.body) });

export function waitForChange(changeId: string, attempts = 40) {
  return pollChange(request, changeId, { attempts });
}
