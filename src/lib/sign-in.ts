/**
 * Signing in, as the web words it: it posts `client: "browser"` to `POST /api/v1/auth/login` and gets
 * a cookie. Paired devices never sign in here; they join by invite (`/paired/invites`).
 */
export const SIGN_IN_UNREACHABLE = "Could not reach FamilyFi.";
export const SIGN_IN_UNREADABLE = "FamilyFi could not complete sign-in. Check the server log.";
export const SIGN_IN_FAILED = "Could not sign in.";
export const SIGN_IN_NOTE = "Password reset is done by another household admin in Settings. Email sign-in is not available in this version.";

/** What to show after `POST /api/v1/auth/login` answered: nothing on success, else the server's message or a fallback. */
export function signInError(response: { ok: boolean; body: unknown }): string | null {
  if (response.ok) return null;
  const message = (response.body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message ? message : SIGN_IN_FAILED;
}
