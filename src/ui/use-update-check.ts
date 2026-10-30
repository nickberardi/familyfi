"use client";

import { useEffect, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import type { UpdateCheck } from "@/lib/types";

/**
 * Reads the server's cached release check from `GET /api/v1/health`: every five
 * seconds while the first check is pending, then once a minute. These reads never
 * reach GitHub; the server checks on its own hourly schedule, and again when an
 * administrator reads `GET /api/v1/settings/update` with a check over five minutes old.
 * A change of `reread` reads it again at once, so a caller that has just had the
 * server check again shows its answer.
 */
export function useUpdateCheck(request: ApiRequest, reread?: unknown): UpdateCheck | null {
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let nextDelay = 60_000;
      try {
        const result = await request<{ update: UpdateCheck }>("/api/v1/health");
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
  }, [request, reread]);
  return update;
}
