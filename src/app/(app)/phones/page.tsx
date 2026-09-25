"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PairPhoneSheet } from "@/components/phones/PairPhoneSheet";
import { PairedPhoneRow } from "@/components/phones/PairedPhoneRow";
import { RemoteAccessCard } from "@/components/phones/RemoteAccessCard";
import { RouteRow } from "@/components/phones/RouteRow";
import { RouteSheet } from "@/components/phones/RouteSheet";
import { api, ApiError } from "@/lib/api";
import { reorderRoutes, sortRoutes } from "@/lib/connection-routes";
import type { ConnectionRoute, PairedPhone } from "@/lib/types";

/** Most recently seen first (the API's order); a test harness can leave hundreds behind. */
const PHONES_SHOWN = 8;
const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";
const CARD_HEAD = "flex flex-wrap items-baseline gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]";

export default function PhonesPage() {
  const [routes, setRoutes] = useState<ConnectionRoute[] | null>(null);
  const [phones, setPhones] = useState<PairedPhone[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ConnectionRoute | "new" | null>(null);
  const [pairing, setPairing] = useState(false);
  const [replacing, setReplacing] = useState<PairedPhone | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [managedId, setManagedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [endpoints, devices] = await Promise.all([
        api<{ endpoints: ConnectionRoute[] }>("/api/v1/connection/endpoints"),
        api<{ devices: PairedPhone[] }>("/api/v1/connection/devices"),
      ]);
      setRoutes(endpoints.endpoints);
      setPhones(devices.devices);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "administrator_required") setForbidden(true);
      else setError(caught instanceof Error ? caught.message : "Could not load phones.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  const onRouteChange = useCallback(
    (id: string | null) => {
      setManagedId(id);
      void load();
    },
    [load],
  );

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    }
    await load();
  }

  const ordered = sortRoutes(routes ?? []);
  const active = phones.filter((phone) => !phone.revokedAt);
  const revoked = phones.filter((phone) => phone.revokedAt);
  const pairedThrough = (id: string) => active.filter((phone) => phone.pairedVia?.endpointId === id).length;
  const strandWarning = (route: ConnectionRoute, verb: string) => {
    const count = pairedThrough(route.id);
    return count
      ? `${count} phone${count === 1 ? "" : "s"} paired through ${route.url}. They keep working through your other routes, but can't use this one once you ${verb} it.`
      : "";
  };
  const canPair = ordered.some((route) => route.enabled);

  if (forbidden) {
    return (
      <>
        <PageHeader title="Phones" sub="Pair the FamilyFi iPhone app and choose how it reaches home." />
        <div className="p-4 md:p-6">
          <div className={`${CARD} px-[18px] py-4 text-[14px]`}>Only a household admin can pair phones or change routes.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Phones"
        sub="Pair the FamilyFi iPhone app and choose how it reaches home."
        actionLabel={canPair ? "Pair a phone" : undefined}
        onAction={canPair ? () => setPairing(true) : undefined}
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {error ? (
          <p role="alert" className="rounded-[9px] bg-[var(--ff-danger-fill)] px-3 py-2.5 text-[14px] font-semibold text-[var(--ff-danger)]">
            {error}
          </p>
        ) : null}

        <RemoteAccessCard onRouteChange={onRouteChange} />

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <span className="text-[14px] font-semibold">Paired phones</span>
            <span className="text-[14px] text-[var(--ff-muted)]">Revoke a lost phone to sign it out everywhere</span>
          </div>
          {active.length === 0 ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
              {canPair ? "No phones yet. Use Pair a phone to add one." : "Add a route below, then pair a phone."}
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
                onRevokeWatch={(sessionId) => {
                  if (!window.confirm("Revoke this Watch session? The Watch will need setup from its iPhone again.")) return;
                  void run(() => api(`/api/v1/connection/devices/${phone.id}/sessions/${sessionId}`, { method: "DELETE" }));
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
              {showAll ? "Show recent only" : `Show all ${active.length} phones`}
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
                        canPair
                          ? () => {
                              setReplacing(phone);
                              setPairing(true);
                            }
                          : undefined
                      }
                      onRemove={() => {
                        if (!window.confirm(`Remove ${phone.displayName} from the list? This can't be undone; the phone would need to pair again.`)) return;
                        void run(() => api(`/api/v1/connection/devices/${phone.id}?remove=true`, { method: "DELETE" }));
                      }}
                    />
                  ))}
                  <div className="border-t border-[var(--ff-hairline)] px-[18px] py-2.5">
                    <button
                      type="button"
                      className="text-[14px] font-semibold text-[var(--ff-danger)]"
                      onClick={() => {
                        if (!window.confirm(`Remove all ${revoked.length} revoked phones from the list? This can't be undone.`)) return;
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

        <section className={CARD}>
          <div className={CARD_HEAD}>
            <span className="text-[14px] font-semibold">Routes</span>
            <span className="min-w-0 flex-1 text-[14px] text-[var(--ff-muted)]">
              Addresses phones try, top first. Add a VPN, Tailscale or Cloudflare route to reach home while away.
            </span>
            <button
              type="button"
              disabled={routes === null}
              className="text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-40"
              onClick={() => setEditing("new")}
            >
              Add route
            </button>
          </div>
          {routes === null ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">Loading…</p>
          ) : ordered.length === 0 ? (
            <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
              No routes yet. Add the HTTPS address phones use to reach FamilyFi at home.
            </p>
          ) : (
            ordered.map((route, index) => (
              <RouteRow
                key={route.id}
                route={route}
                first={index === 0}
                last={index === ordered.length - 1}
                phones={pairedThrough(route.id)}
                managed={route.id === managedId}
                onToggle={() => {
                  const warning = route.enabled ? strandWarning(route, "turn off") : "";
                  if (warning && !window.confirm(warning)) return;
                  void run(() => api(`/api/v1/connection/endpoints/${route.id}`, { method: "PUT", body: JSON.stringify({ enabled: !route.enabled }) }));
                }}
                onMove={(direction) =>
                  void run(async () => {
                    for (const change of reorderRoutes(ordered, route.id, direction)) {
                      await api(`/api/v1/connection/endpoints/${change.id}`, { method: "PUT", body: JSON.stringify({ priority: change.priority }) });
                    }
                  })
                }
                onEdit={() => setEditing(route)}
                onDelete={() => {
                  const warning = strandWarning(route, "delete");
                  if (!window.confirm(warning ? `${warning} Delete it?` : `Delete ${route.url}?`)) return;
                  void run(() => api(`/api/v1/connection/endpoints/${route.id}`, { method: "DELETE" }));
                }}
              />
            ))
          )}
        </section>
      </div>

      {editing ? (
        <RouteSheet
          route={editing === "new" ? null : editing}
          routes={ordered}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
      {pairing ? (
        <PairPhoneSheet
          routes={ordered}
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
