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
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, client: "browser" }),
      });
      const data = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(data.error?.message || "Could not sign in.");
        return;
      }
      router.replace("/family");
      router.refresh();
    } catch {
      setError("Could not reach FamilyFi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3.5 rounded-[14px] border border-[var(--ff-line)] bg-white p-5"
    >
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-muted)]">
        Username
        <input
          className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)] outline-none focus:border-[var(--ff-accent)] focus:shadow-[0_0_0_3px_rgba(0,122,255,0.16)]"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="admin"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[var(--ff-muted)]">
        Password
        <input
          className="rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px] font-normal text-[var(--ff-ink)] outline-none focus:border-[var(--ff-accent)] focus:shadow-[0_0_0_3px_rgba(0,122,255,0.16)]"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
        />
      </label>
      {error ? (
        <div className="rounded-[9px] bg-[rgba(255,59,48,0.1)] px-3 py-2.5 text-[14px] leading-5 text-[var(--ff-danger)]">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-[9px] bg-[var(--ff-accent)] py-3 text-center text-[16px] font-semibold text-white disabled:opacity-60"
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
