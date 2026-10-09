"use client";

import { useCallback, useEffect, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import type { UpdateSettings } from "@/lib/types";
import { loadUpdateSettings } from "@/lib/update-writes";

/**
 * Reads `GET /api/v1/update`: every five seconds while an install is under way, so the page follows
 * FamilyFi through its restart, and once a minute otherwise. A failed read keeps the last answer,
 * as it does while FamilyFi restarts.
 */
export function useUpdateSettings(request: ApiRequest): { settings: UpdateSettings | null; reload: () => void } {
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let underWay = false;
    const poll = async () => {
      try {
        const result = await loadUpdateSettings(request);
        if (cancelled) return;
        setSettings(result);
        underWay = result.lastRun?.status === "requested";
      } catch {
        // While FamilyFi restarts nothing answers; an install under way keeps the quick pace.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), underWay ? 5_000 : 60_000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [request, nonce]);
  return { settings, reload };
}
