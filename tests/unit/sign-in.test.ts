import { describe, expect, it } from "vitest";
import { SIGN_IN_FAILED, signInError } from "@/lib/sign-in";

describe("sign-in outcome", () => {
  it("shows nothing on success, the server's message, or a fallback", () => {
    expect(signInError({ ok: true, body: { token: "t" } })).toBeNull();
    expect(signInError({ ok: false, body: { error: { code: "invalid_credentials", message: "Invalid username or password." } } })).toBe("Invalid username or password.");
    expect(signInError({ ok: false, body: { error: { code: "x" } } })).toBe(SIGN_IN_FAILED);
    expect(signInError({ ok: false, body: null })).toBe(SIGN_IN_FAILED);
  });
});
