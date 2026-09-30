/**
 * What every client's `/api/v1` transport shares: the request shape the shared store and writes
 * call, the errors it throws, and change polling. Each client supplies its own transport — the
 * browser's cookie session with its CSRF header (`api.ts`), or a native app's bearer session.
 */

/** A response from the server with an error status; `code` is the API's `error.code`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
