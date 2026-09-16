"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SignInForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      let response: Response;
      try {
        response = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ username, password, client: "browser" }),
        });
      } catch {
        setError("Could not reach FamilyFi.");
        return;
      }
      let data: { error?: { message: string } } | null = null;
      try {
        data = (await response.json()) as { error?: { message: string } };
      } catch {
        setError("FamilyFi could not complete sign-in. Check the server log.");
        return;
      }
      if (!response.ok) {
        setError(data.error?.message || "Could not sign in.");
        return;
      }
      router.replace("/family");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--ff-line)] bg-[var(--ff-card)] p-5"
    >
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-muted)]">
        Username
        <input
          className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)] outline-none focus:border-[var(--ff-accent)] focus:shadow-[0_0_0_3px_var(--ff-focus-ring)]"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="admin"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-muted)]">
        Password
        <input
          className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)] outline-none focus:border-[var(--ff-accent)] focus:shadow-[0_0_0_3px_var(--ff-focus-ring)]"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
        />
      </label>
      {error ? (
        <div className="rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] leading-5 text-[var(--ff-danger)]">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-[9px] bg-[var(--ff-accent)] py-3 text-center text-[16px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-[14px] leading-5 text-[var(--ff-muted)]">
        Password reset is done by another household admin in Settings. Email sign-in is not available
        in this version.
      </p>
    </form>
  );
}
