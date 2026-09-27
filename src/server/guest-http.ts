import { GuestError } from "./guests";
import { jsonCaughtError, jsonError } from "./http";

export function guestResponseError(error: unknown): Response {
  if (error instanceof GuestError) return jsonError(error.status, error.code, error.message);
  return jsonCaughtError(error);
}
