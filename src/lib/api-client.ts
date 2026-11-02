/**
 * What every client's `/api/v1` transport shares: the request shape the shared store and writes
 * call, the errors it throws, and change polling. Each client supplies its own transport — the
 * browser's cookie session with its CSRF header (`api.ts`), or a native app's bearer session.
 */

/** Where an error points the person next (`error.link` in an API error): a button's words and its address. */
export type ErrorLink = { label: string; url: string };

/** A response from the server with an error status; `code` is the API's `error.code`, `link` its `error.link`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly link?: ErrorLink,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Only an https link is followed: never another app's deep link or a script. */
function httpsUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The error an API response body carries, read defensively: a `link` is kept only when its label is text and its url https. */
export function apiErrorOf(body: unknown, status: number): ApiError {
  const error = (body as { error?: { code?: unknown; message?: unknown; link?: { label?: unknown; url?: unknown } } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message : "Request failed.";
  const code = typeof error?.code === "string" ? error.code : undefined;
  const url = httpsUrl(error?.link?.url);
  const link = typeof error?.link?.label === "string" && url ? { label: error.link.label, url } : undefined;
  return new ApiError(message, status, code, link);
}

/** What a failed action shows: its message, and the error's link when it has one. */
export type ErrorNotice = { text: string; link?: ErrorLink };

/** `errorNotice`, but only an API error's own message is shown; anything else reads as `fallback`. */
export function apiErrorNotice(caught: unknown, fallback: string): ErrorNotice {
  return caught instanceof ApiError ? errorNotice(caught, fallback) : { text: fallback };
}

/** An API error's message and link; any other error's message; else `fallback`. */
export function errorNotice(caught: unknown, fallback: string): ErrorNotice {
  if (caught instanceof ApiError) return caught.link ? { text: caught.message, link: caught.link } : { text: caught.message };
  return { text: caught instanceof Error ? caught.message : fallback };
}

/** No response at all: the server could not be reached, so a write may or may not have landed. */
export class TransportError extends Error {
  constructor(readonly cause: unknown) {
    super("Can't reach FamilyFi.");
    this.name = "TransportError";
  }
}

/** One `/api/v1` call. `body` is a JSON value; the transport serializes it. */
export type ApiRequest = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

export type ChangeOutcome = { status: string; error: string | null };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a change until the gateway has it: every 750 ms, up to 40 times, then reports it as
 * still pending.
 */
export async function waitForChange(
  request: ApiRequest,
  changeId: string,
  { attempts = 40, interval = 750, sleep = wait }: { attempts?: number; interval?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ChangeOutcome> {
  for (let i = 0; i < attempts; i++) {
    const { change } = await request<{ change: ChangeOutcome }>(`/api/v1/changes/${changeId}`);
    if (change.status !== "pending") return change;
    await sleep(interval);
  }
  return { status: "pending", error: "Still applying. Check Sync for the latest result." };
}
