"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function readCsrf(): string {
  const match = document.cookie.match(/(?:^|; )familyfi_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      headers: { "x-csrf-token": readCsrf() },
    });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className="self-start rounded-[9px] border border-[var(--ff-line)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ff-accent)]"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
