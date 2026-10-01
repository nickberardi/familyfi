"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import { resolverScheduleLine, toggleProbeDay, type UpstreamResolverSettings } from "@/lib/upstream";
import { CATEGORIES_COPY, canSaveResolverUrl, clearResolver, saveResolverUrl, updateResolver } from "@/lib/upstream-writes";
import { useAppData } from "@/components/AppDataProvider";
import { TextField, TimeField } from "@/components/ui/Controls";
import { DayPicker } from "@/components/ui/DayPicker";

/**
 * The household DNS-over-HTTPS endpoint, shown in full. Seeing what you configured is
 * the point: a mistyped profile id is otherwise invisible behind an unknown verdict.
 */
const COPY = CATEGORIES_COPY.resolver;

export function ResolverCard({
  resolver,
  onChanged,
}: {
  resolver: UpstreamResolverSettings | null;
  onChanged: () => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError("");
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const canSave = !busy && canSaveResolverUrl(url);
  const { household } = useAppData();
  const timezone = household?.timezone ?? "America/New_York";

  function toggleDay(day: number) {
    if (!resolver) return;
    void run(() => updateResolver(request, { probeDays: toggleProbeDay(resolver.probeDays, day) }), COPY.daysFailed);
  }

  function save() {
    void run(
      () =>
        saveResolverUrl(request, url).then(() => {
          setPasting(false);
          setUrl("");
        }),
      COPY.saveFailed,
    );
  }

  return (
    <section
      className="overflow-hidden rounded-[12px]"
      style={{
        background: "var(--ff-card)",
        border: "1px solid var(--ff-hairline-card)",
      }}
    >
      <div
        className="px-[18px] py-[15px] text-[14px] font-semibold"
        style={{ borderBottom: "1px solid var(--ff-hairline-card)" }}
      >
        {COPY.title}
      </div>
      <div className="px-[18px] py-4">
        {resolver?.url && !pasting ? (
          <p className="m-0 break-all font-mono text-[13px]">{resolver.url}</p>
        ) : null}
        {!resolver?.url && !pasting ? (
          <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
            {resolver?.source === "dhcp" ? COPY.dhcp : resolver?.reason ?? COPY.unavailable}
          </p>
        ) : null}
        {resolver?.networks?.map((network) => (
          <p key={network.id} className="mt-1 mb-0 text-[12px] text-[var(--ff-ink-3)]">
            {network.name}: {network.reason ?? network.servers.join(", ")}
          </p>
        ))}
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
          {COPY.note}
        </p>

        {resolver ? (
          <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid var(--ff-hairline)" }}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold">{COPY.schedule}</div>
                <div className="mt-0.5 text-[12px]" style={{ color: "var(--ff-ink-3)" }}>
                  {resolverScheduleLine(resolver, timezone, new Date())}
                </div>
              </div>
              <TimeField
                label={COPY.time}
                value={resolver.probeTime}
                disabled={busy}
                onChange={(next) => void run(() => updateResolver(request, { probeTime: next }), COPY.timeFailed)}
              />
            </div>
            <div className="mt-2.5">
              <DayPicker days={resolver.probeDays} onToggle={toggleDay} disabled={busy} />
            </div>
          </div>
        ) : null}

        {pasting ? (
          <div className="mt-3 flex flex-col gap-2">
            <TextField
              label={COPY.endpoint}
              value={url}
              onChange={setUrl}
              placeholder={COPY.placeholder}
              onSubmit={() => {
                if (canSave) save();
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canSave}
                onClick={save}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: canSave ? "var(--ff-accent)" : "var(--ff-field-strong)",
                  color: canSave ? "var(--ff-ink-on-fill)" : "var(--ff-locked)",
                }}
              >
                {COPY.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasting(false);
                  setUrl("");
                  setError("");
                }}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-ink-3)" }}
              >
                {COPY.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPasting(true)}
              className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
              style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-accent)" }}
            >
              {resolver?.url ? COPY.replace : COPY.add}
            </button>
            {resolver ? (
              <>
                {resolver.url ? <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => updateResolver(request, { probeEnabled: !resolver.probeEnabled }), COPY.toggleFailed)}
                  className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-ink-2)" }}
                >
                  {resolver.probeEnabled ? COPY.checkingOn : COPY.checkingOff}
                </button> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => clearResolver(request), COPY.clearFailed)}
                  className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-danger)" }}
                >
                  {COPY.remove}
                </button>
              </>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="mt-2 mb-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
