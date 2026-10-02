"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { RemoteAccessCard } from "@/components/pair/RemoteAccessCard";
import { api, ApiError } from "@/lib/api";
import { PAIR_COPY, confirmLine, publishedRoute, removeAllConfirm, removeConfirm, revokeConfirm, splitPhones } from "@/lib/pair-device";
import type { ConnectionRoute, PairedPhone, RemoteAccess } from "@/lib/types";
import { PairedDevicesCard } from "@/ui/PairedDevices";

const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";
const TITLE = PAIR_COPY.title;
const SUB = PAIR_COPY.sub;

export default function PairDevicePage() {
  const [tunnel, setTunnel] = useState<RemoteAccess | null>(null);
  const [routes, setRoutes] = useState<ConnectionRoute[] | null>(null);
  const [phones, setPhones] = useState<PairedPhone[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState(false);
  const [replacing, setReplacing] = useState<PairedPhone | null>(null);

  const load = useCallback(async () => {
    try {
      const [state, endpoints, devices] = await Promise.all([
        api<{ tunnel: RemoteAccess }>("/api/v1/connection/tunnel"),
        api<{ endpoints: ConnectionRoute[] }>("/api/v1/connection/endpoints"),
        api<{ devices: PairedPhone[] }>("/api/v1/connection/devices"),
      ]);
      setTunnel(state.tunnel);
      setRoutes(endpoints.endpoints);
      setPhones(devices.devices);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "administrator_required") setForbidden(true);
      else setError(caught instanceof Error ? caught.message : PAIR_COPY.loadFailed);
    }
  }, []);

  // Poll quickly while a tunnel is on its way, so its address and status appear by themselves.
  const waiting = tunnel?.status === "signing-in" || tunnel?.status === "starting";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
    const timer = setInterval(() => void load(), waiting ? 2000 : 15000);
    return () => clearInterval(timer);
  }, [load, waiting]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : PAIR_COPY.actionFailed);
    }
    await load();
  }

  const { active } = splitPhones(phones);
  const pairedThrough = (id: string) => active.filter((phone) => phone.pairedVia?.endpointId === id).length;
  // Phones pair through the one published route, once it is live.
  const published = publishedRoute(tunnel, routes);
  const canPair = published !== null;

  if (forbidden) {
    return (
      <>
        <PageHeader title={TITLE} sub={SUB} />
        <div className="p-4 md:p-6">
          <div className={`${CARD} px-[18px] py-4 text-[14px]`}>{PAIR_COPY.adminOnly}</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={TITLE} sub={SUB} actionLabel={canPair ? PAIR_COPY.pairPhone : undefined} onAction={canPair ? () => setPairing(true) : undefined} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {error ? (
          <p role="alert" className="rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}

        <RemoteAccessCard tunnel={tunnel} routes={routes} phones={phones} pairedThrough={pairedThrough} onTunnel={setTunnel} onChange={load} />

        <PairedDevicesCard
          phones={phones}
          canPair={canPair}
          onRevoke={(phone) => {
            if (!window.confirm(confirmLine(revokeConfirm(phone)))) return;
            void run(() => api(`/api/v1/connection/devices/${phone.id}`, { method: "DELETE" }));
          }}
          onRepair={(phone) => {
            setReplacing(phone);
            setPairing(true);
          }}
          onRemove={(phone) => {
            if (!window.confirm(confirmLine(removeConfirm(phone)))) return;
            void run(() => api(`/api/v1/connection/devices/${phone.id}?remove=true`, { method: "DELETE" }));
          }}
          onRemoveAllRevoked={(count) => {
            if (!window.confirm(confirmLine(removeAllConfirm(count)))) return;
            void run(() => api("/api/v1/connection/devices?revoked=true", { method: "DELETE" }));
          }}
        />
      </div>

      {pairing && published ? (
        <PairPhoneSheet
          route={published}
          replacing={replacing}
          onClose={() => {
            setPairing(false);
            setReplacing(null);
            void load();
          }}
          onPaired={() => void load()}
        />
      ) : null}
    </>
  );
}
