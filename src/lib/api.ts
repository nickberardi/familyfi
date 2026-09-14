import { CSRF_COOKIE, CSRF_HEADER } from "./constants";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

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

export async function waitForChange(changeId: string, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const { change } = await api<{ change: { status: string; error: string | null } }>(`/api/v1/changes/${changeId}`);
    if (change.status !== "pending") return change;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return { status: "pending", error: "Still applying. Check Sync for the latest result." };
}
