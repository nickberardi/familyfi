import { requireCsrf, requireSession } from "./auth";
import { jsonCaughtError, jsonError } from "./http";

export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "Request body must be JSON.") };
  }
}

export async function withSession(request: Request, handler: () => Promise<Response>): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    return await handler();
  } catch (error) {
    return jsonCaughtError(error);
  }
}

export async function withMutation(request: Request, handler: () => Promise<Response>): Promise<Response> {
  try {
    const { session, error } = await requireSession(request);
    if (error || !session) return error!;
    const csrf = await requireCsrf(request);
    if (csrf) return csrf;
    return await handler();
  } catch (error) {
    return jsonCaughtError(error);
  }
}
