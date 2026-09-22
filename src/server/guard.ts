import { requireCsrf, requireSession } from "./auth";
import { isAdministrator } from "./connection";
import { withChangeActor } from "./changes";
import { jsonCaughtError, jsonError } from "./http";

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "Request body must be JSON.") };
  }
}

export async function withSession(request: Request, handler: (session: NonNullable<Awaited<ReturnType<typeof requireSession>>["session"]>) => Promise<Response>): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    return await withChangeActor({ accountId: session.accountId, deviceId: session.deviceId }, () => handler(session));
  } catch (error) {
    return jsonCaughtError(error);
  }
}

export async function withMutation(request: Request, handler: (session: NonNullable<Awaited<ReturnType<typeof requireSession>>["session"]>) => Promise<Response>): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    const csrf = await requireCsrf(request);
    if (csrf) return csrf;
    return await withChangeActor({ accountId: session.accountId, deviceId: session.deviceId }, () => handler(session));
  } catch (error) {
    return jsonCaughtError(error);
  }
}

export async function withAdmin(request: Request, handler: (session: NonNullable<Awaited<ReturnType<typeof requireSession>>["session"]>) => Promise<Response>): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    const csrf = await requireCsrf(request);
    if (csrf) return csrf;
    if (!isAdministrator(session as never)) return jsonError(403, "administrator_required", "A FamilyFi administrator is required.");
    return await withChangeActor({ accountId: session.accountId, deviceId: session.deviceId }, () => handler(session));
  } catch (error) {
    return jsonCaughtError(error);
  }
}
