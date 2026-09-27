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
  resolver,
  onChanged,
}: {
  groupId: string;
  groupName: string;
  dohOverrideUrl: string | null;
  resolver: { source: "doh" | "dhcp" | "unknown"; networks: { id: string; name: string; servers: string[]; reason: string | null }[]; reason: string | null } | null;
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
        DNS resolver
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
              DNS-over-HTTPS override for {groupName}. Category results here are
              measured through this endpoint.
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
              {resolver?.reason ? resolver.reason
                : resolver?.source === "dhcp" ? "Uses the DNS servers assigned to this group's devices by UniFi DHCP."
                : resolver?.source === "doh" ? "Uses the household's DNS-over-HTTPS override."
                  : resolver?.reason ?? "Resolver information is unavailable."}
            </p>
            {resolver?.networks.map((network) => (
              <p key={network.id} className="mt-1 mb-0 text-[12px] text-[var(--ff-ink-3)]">
                {network.name}: {network.reason ?? network.servers.join(", ")}
              </p>
            ))}
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

        {!pasting ? <p className="mt-2 mb-0 text-[12px] text-[var(--ff-ink-3)]">
          Checks run from the FamilyFi host. A device on another VLAN may get a different answer.
        </p> : null}

        {error ? (
          <p className="mt-2 mb-0 text-[13px]" style={{ color: "var(--ff-danger)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
