"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { TextField } from "@/components/ui/Controls";

/**
 * A group's own DNS-over-HTTPS endpoint, from the design's member view.
 *
 * Its purpose is accuracy of reporting, not enforcement: with an override set, this
 * group's category verdicts are measured through *its* resolver, so its cards answer
 * for the devices it actually has rather than for the rest of the house. Pointing
 * those devices at that resolver is a DHCP or client-side job, outside FamilyFi.
 */
export function GroupResolverCard({
  groupId,
  groupName,
  dohOverrideUrl,
  householdConfigured,
  onChanged,
}: {
  groupId: string;
  groupName: string;
  dohOverrideUrl: string | null;
  householdConfigured: boolean;
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

  function save() {
    if (url.trim().length <= 8) return;
    void run(
      () =>
        api(`/api/v1/groups/${groupId}/resolver`, {
          method: "PUT",
          body: JSON.stringify({ url: url.trim() }),
        }).then(() => {
          setPasting(false);
          setUrl("");
        }),
      "Could not save the endpoint.",
    );
  }

  const canSave = !busy && url.trim().length > 8;

  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">
        DNS-over-HTTPS
      </h2>
      <div className="px-[18px] py-4">
        {pasting ? (
          <div className="flex flex-col gap-2">
            <TextField
              label={`DNS-over-HTTPS endpoint for ${groupName}`}
              value={url}
              onChange={setUrl}
              placeholder="https://dns.example.com/dns-query/profile"
              onSubmit={save}
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
                {/* Not just "Save" — the group's Edit form already has one on this page. */}
                Save endpoint
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
        ) : dohOverrideUrl ? (
          <>
            <p className="m-0 break-all font-mono text-[13px]">{dohOverrideUrl}</p>
            <p className="mt-1 mb-0 text-[12px]" style={{ color: "var(--ff-ink-3)" }}>
              Overrides the household default for {groupName} only — a
              special-consideration setup. Category results here are measured through
              this endpoint.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPasting(true)}
                className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-accent)" }}
              >
                Replace
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => api(`/api/v1/groups/${groupId}/resolver`, { method: "DELETE" }),
                    "Could not remove the override.",
                  )
                }
                className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-danger)" }}
              >
                Remove override
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
              {householdConfigured
                ? "Uses the household default set in Categories."
                : "Uses the household default, which is not set yet — add one in Categories."}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPasting(true)}
              className="mt-2.5 rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
              style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-accent)" }}
            >
              Override for this member
            </button>
          </>
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
