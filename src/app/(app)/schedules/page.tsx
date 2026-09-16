"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SchedulesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    router.replace(`/rules${hash}`);
  }, [router]);
  return <p className="p-6 text-[14px] text-[var(--ff-muted)]">Redirecting to Rules…</p>;
}
