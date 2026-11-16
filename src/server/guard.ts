import type { z } from "zod";
import { requireCsrf, requireSession, type SignedInSession } from "./auth";
import { isAdministrator } from "./connection";
import { withChangeActor } from "./changes";
import { demoLocked } from "./demo";
import { jsonCaughtError, jsonError } from "./http";

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "Request body must be JSON.") };
  }
}

/** A request's JSON body, checked against its schema; `message` is what the caller reads when it does not fit. */
export async function readBody<T>(request: Request, schema: z.ZodType<T>, message: string): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const body = await readJson(request);
  if (!body.ok) return body;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return { ok: false, response: jsonError(400, "invalid_request", message) };
  return { ok: true, data: parsed.data };
}

type Handler = (session: SignedInSession) => Promise<Response>;

/** Which requests must carry the CSRF token, and whether the caller must be an administrator. */
type Checks = { csrf: "never" | "always" | "writes"; administrator: boolean };

/** `demoLock` refuses the request in the shared demo, once the caller has passed the guard's own checks. */
type Options = { demoLock?: boolean };

async function guarded(request: Request, checks: Checks & Options, handler: Handler): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    // Reads carry no CSRF risk, and the browser client only sends the header on writes.
    const safe = request.method === "GET" || request.method === "HEAD";
    const csrf = checks.csrf === "never" || (checks.csrf === "writes" && safe) ? null : await requireCsrf(request);
    if (csrf) return csrf;
    if (checks.administrator && !isAdministrator(session)) return jsonError(403, "administrator_required", "A FamilyFi administrator is required.");
    const locked = checks.demoLock ? demoLocked() : null;
    if (locked) return locked;
    return await withChangeActor({ accountId: session.accountId, deviceId: session.deviceId }, () => handler(session));
  } catch (error) {
    return jsonCaughtError(error);
  }
}

export function withSession(request: Request, handler: Handler, options: Options = {}): Promise<Response> {
  return guarded(request, { csrf: "never", administrator: false, ...options }, handler);
}

export function withMutation(request: Request, handler: Handler, options: Options = {}): Promise<Response> {
  return guarded(request, { csrf: "always", administrator: false, ...options }, handler);
}

export function withAdmin(request: Request, handler: Handler, options: Options = {}): Promise<Response> {
  return guarded(request, { csrf: "writes", administrator: true, ...options }, handler);
}
