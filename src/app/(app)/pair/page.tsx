"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PairPhoneSheet } from "@/components/pair/PairPhoneSheet";
import { PairedPhoneRow } from "@/components/pair/PairedPhoneRow";
import { RemoteAccessCard } from "@/components/pair/RemoteAccessCard";
import { api, ApiError } from "@/lib/api";
import type { ConnectionRoute, PairedPhone, RemoteAccess } from "@/lib/types";

/** Most recently seen first (the API's order); a test harness can leave hundreds behind. */
const PHONES_SHOWN = 8;
const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";
const CARD_HEAD = "flex flex-wrap items-baseline gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]";
const TITLE = "Pair Device";
const SUB = "Pair the FamilyFi iPhone app and choose how it reaches home.";

export default function PairDevicePage() {
  const [tunnel, setTunnel] = useState<RemoteAccess | null>(null);
  const [routes, setRoutes] = useState<ConnectionRoute[] | null>(null);
  const [phones, setPhones] = useState<PairedPhone[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState(false);
  const [replacing, setReplacing] = useState<PairedPhone | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [showAll, setShowAll] = useState(false);

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
      else setError(caught instanceof Error ? caught.message : "Could not load remote access.");
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
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    }
    await load();
  }

  const active = phones.filter((phone) => !phone.revokedAt);
  const revoked = phones.filter((phone) => phone.revokedAt);
  const pairedThrough = (id: string) => active.filter((phone) => phone.pairedVia?.endpointId === id).length;
  // Phones pair through the one published route, once it is live.
  const published = routes?.find((route) => route.id === tunnel?.endpointId && route.enabled) ?? null;
  const canPair = published !== null;

  if (forbidden) {
    return (
      <>
        <PageHeader title={TITLE} sub={SUB} />
        <div className="p-4 md:p-6">
          <div className={`${CARD} px-[18px] py-4 text-[14px]`}>Only a household admin can pair phones or change remote access.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={TITLE} sub={SUB} actionLabel={canPair ? "Pair a phone" : undefined} onAction={canPair ? () => setPairing(true) : undefined} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {error ? (
          <p role="alert" className="rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}

        <RemoteAccessCard tunnel={tunnel} routes={routes} phones={phones} pairedThrough={pairedThrough} onTunnel={setTunnel} onChange={load} />

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <span className="text-[14px] font-semibold">Paired devices</span>
            <span className="text-[14px] text-[var(--ff-muted)]">Revoke a lost phone or Watch independently</span>
          </div>
          {active.length === 0 ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
              {canPair ? "No phones yet. Use Pair a phone to add one." : "Turn on remote access, then pair a phone."}
            </p>
          ) : (
            (showAll ? active : active.slice(0, PHONES_SHOWN)).map((phone) => (
              <PairedPhoneRow
                key={phone.id}
                phone={phone}
                onRevoke={() => {
                  if (!window.confirm(`Revoke ${phone.displayName}? It is signed out now and must be paired again.`)) return;
                  void run(() => api(`/api/v1/connection/devices/${phone.id}`, { method: "DELETE" }));
                }}
              />
            ))
          )}
          {active.length > PHONES_SHOWN ? (
            <button
              type="button"
              className="w-full border-t border-[var(--ff-hairline)] px-[18px] py-2.5 text-left text-[14px] font-semibold text-[var(--ff-accent)]"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? "Show recent only" : `Show all ${active.length} devices`}
            </button>
          ) : null}
          {revoked.length ? (
            <div className="border-t border-[var(--ff-hairline)]">
              <button
                type="button"
                aria-expanded={showRevoked}
                className="w-full px-[18px] py-2.5 text-left text-[14px] font-semibold text-[var(--ff-accent)]"
                onClick={() => setShowRevoked((value) => !value)}
              >
                {showRevoked ? "Hide" : "Show"} revoked ({revoked.length})
              </button>
              {showRevoked ? (
                <>
                  {revoked.map((phone) => (
                    <PairedPhoneRow
                      key={phone.id}
                      phone={phone}
                      onRepair={
                        canPair && phone.client === "phone"
                          ? () => {
                              setReplacing(phone);
                              setPairing(true);
                            }
                          : undefined
                      }
                      onRemove={() => {
                        if (!window.confirm(`Remove ${phone.displayName} from the list? This can't be undone; setup would be needed again.`)) return;
                        void run(() => api(`/api/v1/connection/devices/${phone.id}?remove=true`, { method: "DELETE" }));
                      }}
                    />
                  ))}
                  <div className="border-t border-[var(--ff-hairline)] px-[18px] py-2.5">
                    <button
                      type="button"
                      className="text-[14px] font-semibold text-[var(--ff-danger)]"
                      onClick={() => {
                        if (!window.confirm(`Remove all ${revoked.length} revoked devices from the list? This can't be undone.`)) return;
                        void run(() => api("/api/v1/connection/devices?revoked=true", { method: "DELETE" }));
                      }}
                    >
                      Remove all revoked
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
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
