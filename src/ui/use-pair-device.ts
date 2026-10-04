"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, type ApiRequest } from "@/lib/api-client";
import { PAIR_COPY, publishedRoute, splitPhones } from "@/lib/pair-device";
import type { ConnectionRoute, PairedPhone, RemoteAccess } from "@/lib/types";

/**
 * Pair Device's data: remote access, its routes and the paired devices (phones, Watches and
 * agents), reloaded every 15 seconds,
 * and every 2 while a tunnel is on its way so its address and status appear by themselves. A
 * session that may not manage paired devices (a Watch's or an agent's) is told so instead.
 */
export function usePairDevice(request: ApiRequest) {
  const [tunnel, setTunnel] = useState<RemoteAccess | null>(null);
  const [routes, setRoutes] = useState<ConnectionRoute[] | null>(null);
  const [phones, setPhones] = useState<PairedPhone[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [state, endpoints, devices] = await Promise.all([
        request<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel"),
        request<{ endpoints: ConnectionRoute[] }>("/api/v1/connection/endpoints"),
        request<{ devices: PairedPhone[] }>("/api/v1/paired/devices"),
      ]);
      setTunnel(state.tunnel);
      setRoutes(endpoints.endpoints);
      setPhones(devices.devices);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "administrator_required") setForbidden(true);
      else setError(caught instanceof Error ? caught.message : PAIR_COPY.loadFailed);
    }
  }, [request]);

  const waiting = tunnel?.status === "signing-in" || tunnel?.status === "starting";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
    const timer = setInterval(() => void load(), waiting ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [load, waiting]);

  /** Runs a change, says why it failed if it did, and reloads either way. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError("");
      try {
        await action();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : PAIR_COPY.actionFailed);
      }
      await load();
    },
    [load],
  );

  const { active } = splitPhones(phones);
  // Agents are home-network only and never hold an Access token, so remote access counts phones and Watches.
  const remote = phones.filter((device) => device.client !== "agent");
  // Phones pair through the one published route, once it is live.
  const published = publishedRoute(tunnel, routes);
  return {
    tunnel,
    setTunnel,
    routes,
    phones,
    remote,
    forbidden,
    error,
    load,
    run,
    published,
    canPair: published !== null,
    pairedThrough: (id: string) => active.filter((phone) => phone.pairedVia?.endpointId === id).length,
  };
}
