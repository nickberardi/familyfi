"use client";

import { useRouter } from "next/navigation";
import { SIGN_IN_UNREACHABLE, SIGN_IN_UNREADABLE, signInError } from "@/lib/sign-in";
import { SignInForm as SharedSignInForm } from "@/ui/SignInForm";

/** Signs this browser in with a cookie session; returns what to show when it could not, else null. */
export async function browserSignIn(username: string, password: string): Promise<string | null> {
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
  return signInError({ ok: response.ok, body });
}

/**
 * The shared sign-in form (`src/ui/SignInForm.tsx`), signing in with the browser's cookie session.
 * `demoLogin` fills it in on the public demo, where every visitor uses the same login.
 */
export function SignInForm({ demoLogin }: { demoLogin?: { username: string; password: string } }) {
  const router = useRouter();

  async function signIn(username: string, password: string): Promise<string | null> {
    const error = await browserSignIn(username, password);
    if (error) return error;
    // Home sends a household with no gateway yet to first-time setup, and everyone else to Family.
    router.replace("/");
    router.refresh();
    return null;
  }

  return <SharedSignInForm onSubmit={signIn} initialUsername={demoLogin?.username} initialPassword={demoLogin?.password} />;
}
