"use client";

import { useCallback, useEffect, useState } from "react";

import type { ApiRequest } from "@/lib/api-client";
import { SETTINGS_COPY } from "@/lib/settings-copy";
import type { GatewayHealth, UnifiSettings } from "@/lib/types";

const failure = (error: unknown) => (error instanceof Error ? error.message : SETTINGS_COPY.healthFailed);

/**
 * Reads `GET /api/v1/health?gateway=true` for Gateway load: once when the caller mounts, and again on
 * `check`. Each read is a request per device to the console, so nothing refreshes it on its own.
 * `target` is null until a gateway is configured, and then nothing is asked.
 */
export function useGatewayHealth(request: ApiRequest, unifi: UnifiSettings | null | undefined) {
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  // The console and site the readings are for: another one starts over, never showing the last one's.
  const target = unifi?.configured ? [unifi.consoleId ?? "", unifi.baseUrl ?? "", unifi.siteId ?? ""].join("|") : null;
  const [shownTarget, setShownTarget] = useState<string | null>(null);
  if (target !== shownTarget) {
    setShownTarget(target);
    setHealth(null);
    setError("");
    setChecking(target !== null);
  }

  const read = useCallback(() => request<{ gateway: GatewayHealth }>("/api/v1/health?gateway=true").then((result) => result.gateway), [request]);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await read());
      setError("");
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setChecking(false);
    }
  }, [read]);
  useEffect(() => {
    if (target === null) return;
    let active = true;
    read()
      .then(
        (result) => active && setHealth(result),
        (caught: unknown) => active && setError(failure(caught)),
      )
      .finally(() => active && setChecking(false));
    return () => {
      active = false;
    };
  }, [target, read]);

  return { target, health, error, checking, check };
}
