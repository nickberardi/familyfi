"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { probeScheduleWhen, type UpstreamResolverSettings } from "@/lib/upstream";
import { formatHhmm, relativeDayLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { TextField, TimeField } from "@/components/ui/Controls";
import { DayPicker } from "@/components/ui/DayPicker";

/**
 * The household DNS-over-HTTPS endpoint, shown in full. Seeing what you configured is
 * the point: a mistyped profile id is otherwise invisible behind an unknown verdict.
 */
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

  const canSave = !busy && url.trim().length > 8;
  const { household } = useAppData();
  const timezone = household?.timezone ?? "America/New_York";

  function toggleDay(day: number) {
    if (!resolver) return;
    const days = resolver.probeDays.includes(day)
      ? resolver.probeDays.filter((d) => d !== day)
      : [...resolver.probeDays, day].sort((a, b) => a - b);
    void run(
      () => api("/api/v1/upstream/resolver", { method: "PUT", body: JSON.stringify({ probeDays: days }) }),
      "Could not change the check days.",
    );
  }

  function scheduleLine(r: UpstreamResolverSettings): string {
    if (!r.probeEnabled) return "Paused — last results kept";
    if (r.probeDays.length === 0) return "No days selected — checking won't run";
    const when = `${probeScheduleWhen(r.probeDays)} at ${formatHhmm(r.probeTime)}`;
    if (!r.nextRunAt) return when;
    return `${when} · next ${relativeDayLabel(new Date(r.nextRunAt), timezone)}`;
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
        DNS-over-HTTPS endpoint
      </div>
      <div className="px-[18px] py-4">
        {resolver?.configured && !pasting ? (
          <p className="m-0 break-all font-mono text-[13px]">{resolver.url}</p>
        ) : null}
        {!resolver?.configured && !pasting ? (
          <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
            Not set. Categories stay unchecked until you paste an endpoint.
          </p>
        ) : null}
        <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
          Queried on a schedule to check whether each category is already blocked
          upstream. Categories keep their last result while this is off.
        </p>

        {resolver?.configured ? (
          <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid var(--ff-hairline)" }}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold">Check schedule</div>
                <div className="mt-0.5 text-[12px]" style={{ color: "var(--ff-ink-3)" }}>
                  {scheduleLine(resolver)}
                </div>
              </div>
              <TimeField
                label="Check time"
                value={resolver.probeTime}
                disabled={busy}
                onChange={(next) =>
                  void run(
                    () => api("/api/v1/upstream/resolver", { method: "PUT", body: JSON.stringify({ probeTime: next }) }),
                    "Could not change the check time.",
                  )
                }
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
              label="DNS-over-HTTPS endpoint"
              value={url}
              onChange={setUrl}
              placeholder="https://dns.example.com/dns-query/profile"
              onSubmit={() => {
                if (canSave) {
                  void run(
                    () =>
                      api("/api/v1/upstream/resolver", {
                        method: "PUT",
                        body: JSON.stringify({ url: url.trim(), probeEnabled: true }),
                      }).then(() => {
                        setPasting(false);
                        setUrl("");
                      }),
                    "Could not save the endpoint.",
                  );
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canSave}
                onClick={() =>
                  void run(
                    () =>
                      api("/api/v1/upstream/resolver", {
                        method: "PUT",
                        body: JSON.stringify({ url: url.trim(), probeEnabled: true }),
                      }).then(() => {
                        setPasting(false);
                        setUrl("");
                      }),
                    "Could not save the endpoint.",
                  )
                }
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: canSave ? "var(--ff-accent)" : "var(--ff-field-strong)",
                  color: canSave ? "var(--ff-ink-on-fill)" : "var(--ff-locked)",
                }}
              >
                Save
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
                Cancel
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
              {resolver?.configured ? "Replace" : "Paste endpoint"}
            </button>
            {resolver?.configured ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        api("/api/v1/upstream/resolver", {
                          method: "PUT",
                          body: JSON.stringify({ probeEnabled: !resolver.probeEnabled }),
                        }),
                      "Could not change checking.",
                    )
                  }
                  className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-ink-2)" }}
                >
                  {resolver.probeEnabled ? "Checking on" : "Checking off"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api("/api/v1/upstream/resolver", { method: "DELETE" }),
                      "Could not clear the endpoint.",
                    )
                  }
                  className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-danger)" }}
                >
                  Remove
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
