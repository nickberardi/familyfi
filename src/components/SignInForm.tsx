"use client";

import { useRouter } from "next/navigation";
import { SIGN_IN_UNREACHABLE, SIGN_IN_UNREADABLE, signInError } from "@/lib/sign-in";
import { SignInForm as SharedSignInForm } from "@/ui/SignInForm";

/** The shared sign-in form (`src/ui/SignInForm.tsx`), signing in with the browser's cookie session. */
export function SignInForm() {
  const router = useRouter();

  async function signIn(username: string, password: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password, client: "browser" }),
      });
    } catch {
      return SIGN_IN_UNREACHABLE;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return SIGN_IN_UNREADABLE;
    }
    const error = signInError({ ok: response.ok, body });
    if (error) return error;
    // Home sends a household with no gateway yet to first-time setup, and everyone else to Family.
    router.replace("/");
    router.refresh();
    return null;
  }

  return <SharedSignInForm onSubmit={signIn} />;
}
