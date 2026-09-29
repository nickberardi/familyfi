"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { UpdateCheck } from "@/lib/types";
import { appVersionLabel } from "@/lib/version";

/**
 * Reads the server's cached release check from `GET /api/v1/health`: every five
 * seconds while the first check is pending, then once a minute. These reads never
 * reach GitHub; the server checks on its own hourly schedule.
 */
export function useUpdateCheck(): UpdateCheck | null {
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let nextDelay = 60_000;
      try {
        const result = await api<{ update: UpdateCheck }>("/api/v1/health");
        if (cancelled) return;
        setUpdate(result.update);
        if (result.update.status === "pending") nextDelay = 5_000;
      } catch {
        // A failed read leaves the last answer in place; the alert only ever claims an update exists.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), nextDelay);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return update;
}

/** The sidebar's "Update available" alert. Renders nothing unless a newer release is published. */
export function UpdateAlert({ update }: { update: UpdateCheck | null }) {
  if (!update?.available || !update.latestVersion) return null;
  const latest = appVersionLabel(update.latestVersion);
  return (
    <section
      aria-label="Update available"
      className="rounded-[9px] border border-[var(--ff-line)] bg-[var(--ff-card)] p-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[var(--ff-accent)]" aria-hidden="true" />
        <span className="text-[14px] font-semibold">Update available</span>
      </div>
      <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">
        {latest} is ready. You&rsquo;re on {appVersionLabel(update.currentVersion)}.
      </p>
      <Link
        href="/update"
        className="mt-2 block w-full rounded-[6px] bg-[var(--ff-accent)] py-1.5 text-center text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
      >
        Update
      </Link>
    </section>
  );
}
