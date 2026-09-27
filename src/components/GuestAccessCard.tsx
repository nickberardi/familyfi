"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Segmented } from "./ui/Segmented";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, SheetFrame } from "./pair/SheetFrame";
import { useAppData } from "./AppDataProvider";

type GuestSnapshot = {
  status: "ready" | "unconfigured" | "unavailable";
  reason: "unifi_unconfigured" | "unifi_unavailable" | "no_guest_network" | "managed_overlap" | null;
  voucherAvailable: boolean;
  clients: { id: string; name: string; mac: string; networkId: string; authorized: boolean }[];
  passes: { id: string; clientId: string; mac: string; networkId: string; status: "active" | "expired" | "revoked" | "unknown"; expiresAt: string | null }[];
  vouchers: { id: string; code: string | null; timeLimitMinutes: number; status: "unused" | "active" | "expired" | "revoked" | "unknown"; expiresAt: string | null }[];
};

const DURATIONS = [
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "1440", label: "1 day" },
] as const;

function timeLabel(value: string | null, timeZone: string): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }) : "Unknown";
}

function emptyReason(snapshot: GuestSnapshot): string {
  if (snapshot.status === "unconfigured") return "Configure UniFi in Settings to use guest access.";
  if (snapshot.status === "unavailable") return "UniFi is unavailable. Current guest access cannot be confirmed.";
  if (snapshot.reason === "no_guest_network") return "Set up a separate guest or hotspot network in UniFi to issue passes.";
  if (snapshot.reason === "managed_overlap") return "Exclude the guest network from FamilyFi's managed networks in Settings before issuing passes.";
  return "No visitors are waiting on the guest network.";
}

export function GuestAccessCard() {
  const { unifi, household } = useAppData();
  const [snapshot, setSnapshot] = useState<GuestSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ kind: "pass"; clientId: string; name: string } | { kind: "voucher" } | null>(null);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]["value"]>("120");
  const [createdCode, setCreatedCode] = useState<{ id: string; code: string } | null>(null);

  const markUnavailable = useCallback((caught: unknown) => {
    setReadError(caught instanceof Error ? caught.message : "UniFi is unavailable.");
    setSnapshot((previous) => ({
      status: "unavailable", reason: "unifi_unavailable", voucherAvailable: false, clients: [],
      passes: previous?.passes.map((pass) => ({ ...pass, status: "unknown" as const })) ?? [],
      vouchers: previous?.vouchers.map((voucher) => ({ ...voucher, status: "unknown" as const })) ?? [],
    }));
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    const next = await api<GuestSnapshot>("/api/v1/guests");
    setSnapshot(next);
    setReadError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void reload().catch(markUnavailable);
    }, 0);
    const timer = window.setInterval(() => { void reload().catch(markUnavailable); }, 15_000);
    return () => { window.clearTimeout(start); window.clearInterval(timer); };
  }, [reload, markUnavailable]);

  async function create() {
    if (!sheet) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (sheet.kind === "pass") {
        await api("/api/v1/guest-passes", {
          method: "POST", body: JSON.stringify({ clientId: sheet.clientId, timeLimitMinutes: Number(duration) }),
        });
        setNotice(`${sheet.name} has guest access for ${DURATIONS.find((item) => item.value === duration)?.label}.`);
      } else {
        const created = await api<{ voucher: GuestSnapshot["vouchers"][number] }>("/api/v1/guest-vouchers", { method: "POST", body: JSON.stringify({ timeLimitMinutes: Number(duration) }) });
        if (created.voucher.code) setCreatedCode({ id: created.voucher.id, code: created.voucher.code });
        setSnapshot((previous) => previous ? { ...previous, vouchers: [created.voucher, ...previous.vouchers] } : previous);
        setNotice("Voucher created. Share the code with your visitor.");
      }
      setSheet(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Guest access could not be confirmed.");
      setSheet(null);
    } finally {
      await reload().catch(markUnavailable);
      setBusy(false);
    }
  }

  async function revoke(kind: "pass" | "voucher", id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/v1/guest-${kind === "pass" ? "passes" : "vouchers"}/${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotice(kind === "pass" ? "Guest access revoked." : "Voucher revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revocation could not be confirmed.");
    } finally {
      await reload().catch(markUnavailable);
      setBusy(false);
    }
  }

  const activePasses = snapshot?.passes.filter((item) => item.status === "active" || item.status === "unknown") ?? [];
  const currentVouchers = snapshot?.vouchers.filter((item) => item.status === "unused" || item.status === "active" || item.status === "unknown") ?? [];
  const waiting = snapshot?.clients.filter((item) => !item.authorized) ?? [];
  const timeZone = household?.timezone ?? "UTC";

  return (
    <section aria-label="Guest access" className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex flex-wrap items-center gap-3 px-[18px] py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">Guest access</h2>
          <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">Give a visitor time on the separate guest network without assigning their device to a group.</p>
        </div>
        <button type="button" className={SECONDARY_BUTTON} disabled={!snapshot?.voucherAvailable || busy} onClick={() => setSheet({ kind: "voucher" })}>Create voucher</button>
      </div>
      {error || readError ? <p role="alert" className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-danger)]">{error || readError}</p> : null}
      {notice ? <p role="status" className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-on)]">{notice}</p> : null}
      {loading ? <p className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-muted)]">Checking guest network…</p> : null}
      {snapshot && !loading ? (
        <>
          {snapshot.status !== "ready" || snapshot.reason ? <p className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-muted)]">{emptyReason(snapshot)}</p> : null}
          {snapshot.status === "ready" && !snapshot.voucherAvailable ? <p className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-muted)]">Vouchers need a separate captive-portal guest Wi-Fi. Check the guest and managed networks in UniFi and Settings.</p> : null}
          {snapshot.status === "ready" && !snapshot.reason && waiting.length === 0 && activePasses.length === 0 && currentVouchers.length === 0 ? <p className="border-t border-[var(--ff-hairline)] px-[18px] py-3 text-[14px] text-[var(--ff-muted)]">{emptyReason(snapshot)}</p> : null}
          {waiting.map((client) => (
            <div key={client.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold">{client.name}</div><div className="font-mono text-[14px] text-[var(--ff-muted)]">{client.mac.toUpperCase()} · {unifi?.networks.find((network) => network.id === client.networkId)?.name ?? "Guest network"}</div></div>
              <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => setSheet({ kind: "pass", clientId: client.id, name: client.name })}>Give access</button>
            </div>
          ))}
          {activePasses.map((pass) => (
            <div key={pass.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3">
              <div className="min-w-0 flex-1"><div className="font-mono text-[14px]">{pass.mac.toUpperCase()}</div><div className="text-[14px] text-[var(--ff-muted)]">{pass.status === "active" ? `Access until ${timeLabel(pass.expiresAt, timeZone)}` : "Access status unknown — check UniFi"}</div></div>
              {pass.status === "active" && snapshot.status === "ready" ? <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void revoke("pass", pass.id)}>Revoke</button> : null}
            </div>
          ))}
          {currentVouchers.map((voucher) => (
            <div key={voucher.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--ff-hairline)] px-[18px] py-3">
              <div className="min-w-0 flex-1"><div className="text-[14px] font-semibold">{voucher.status === "unknown" ? "Voucher status unknown" : voucher.status === "unused" ? "Unused voucher" : `Voucher active until ${timeLabel(voucher.expiresAt, timeZone)}`}</div><div className="font-mono text-[14px] text-[var(--ff-muted)]">{voucher.code ?? (createdCode?.id === voucher.id ? createdCode.code : null) ?? "Code unavailable"}</div></div>
              {voucher.code || createdCode?.id === voucher.id ? <button type="button" className={SECONDARY_BUTTON} onClick={() => void navigator.clipboard.writeText(voucher.code ?? createdCode!.code).then(() => setNotice("Voucher code copied.")).catch(() => setError("Could not copy the code."))}>Copy code</button> : null}
              {voucher.status !== "unknown" && snapshot.status === "ready" ? <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => void revoke("voucher", voucher.id)}>Revoke</button> : null}
            </div>
          ))}
        </>
      ) : null}
      {sheet ? <SheetFrame title={sheet.kind === "pass" ? `Guest access for ${sheet.name}` : "Create guest voucher"} sub={sheet.kind === "pass" ? "UniFi will allow this visitor on the separate guest network for the time you choose." : "One visitor can redeem this code on the hotspot portal. Time begins on first use."} onClose={() => !busy && setSheet(null)} footer={<><button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setSheet(null)}>Cancel</button><button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={() => void create()}>{busy ? "Working…" : sheet.kind === "pass" ? "Give access" : "Create code"}</button></>}><Segmented name="Access duration" value={duration} segments={DURATIONS} onChange={setDuration} grow /></SheetFrame> : null}
    </section>
  );
}
