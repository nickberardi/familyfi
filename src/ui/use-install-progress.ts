"use client";

import { useEffect, useRef, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import type { UpdateCheck, UpdateRun, UpdateSettings } from "@/lib/types";
import { installCountdownLine, installedVersion } from "@/lib/update-copy";

const HEALTH_POLL_MS = 5_000;

/**
 * Follows an install from the request until `GET /api/v1/health` reports the new release, then calls
 * `onInstalled` with that release once. Meanwhile it returns the release and the countdown over the card, ticking each second. A
 * read that fails while FamilyFi restarts is expected and simply tried again. The watch ends without
 * `onInstalled` when the install settles any other way, and its outcome line says why.
 */
export function useInstallProgress(settings: UpdateSettings | null, request: ApiRequest | undefined, onInstalled: (version: string) => void): { target: string; countdown: string } | null {
  const run = settings?.lastRun ?? null;
  const [watched, setWatched] = useState<UpdateRun | null>(run?.status === "requested" ? run : null);
  // When this device first saw the watched install, and now; set by the effect's timers.
  const [clock, setClock] = useState<{ seenAt: Date; now: Date } | null>(null);
  const installed = useRef(onInstalled);
  useEffect(() => {
    installed.current = onInstalled;
  });

  // Each answer from the settings poll starts a watch, or ends one that settled other than by installing.
  const [seen, setSeen] = useState(run);
  if (run !== seen) {
    setSeen(run);
    if (run?.status === "requested" && watched?.requestedAt !== run.requestedAt) setWatched(run);
    else if (run && run.status !== "requested" && run.status !== "succeeded" && watched?.requestedAt === run.requestedAt) setWatched(null);
  }

  useEffect(() => {
    if (!watched || !request) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const health = await request<{ update: UpdateCheck }>("/api/v1/health");
        if (cancelled) return;
        if (installedVersion(health.update.currentVersion, watched.targetVersion)) {
          setWatched(null);
          installed.current(watched.targetVersion);
          return;
        }
      } catch {
        // Nothing answers while FamilyFi restarts.
      }
      if (!cancelled) timer = setTimeout(() => void poll(), HEALTH_POLL_MS);
    };
    timer = setTimeout(() => void poll(), HEALTH_POLL_MS);
    const seenAt = new Date();
    const start = setTimeout(() => setClock({ seenAt, now: new Date() }), 0);
    const tick = setInterval(() => setClock({ seenAt, now: new Date() }), 1_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(start);
      clearInterval(tick);
    };
  }, [watched, request]);

  if (!watched) return null;
  const now = clock?.now ?? new Date(watched.requestedAt);
  return { target: watched.targetVersion, countdown: installCountdownLine(watched.requestedAt, now, clock?.seenAt ?? now) };
}
