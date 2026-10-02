export const RECOVERY_USERNAME = "admin";
export const SESSION_COOKIE = "familyfi_session";
export const CSRF_COOKIE = "familyfi_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;
/** Stamped by the phone-only gateway on every request it forwards from a tunnel. */
export const TUNNEL_HEADER = "x-familyfi-via";
/** A paired device's bearer; it renews with its refresh token. Browser cookies use `SESSION_TTL_MS`. */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
/** A refresh token lives this long from its last use. */
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** How long a just-replaced refresh token is honoured once, for a client that lost the response. */
export const REFRESH_REUSE_GRACE_MS = 10 * 1000;
