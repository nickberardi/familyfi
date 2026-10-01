"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import {
  GROUP_RESOLVER_COPY as COPY,
  canSaveGroupResolver,
  groupResolverNetworkLine,
  groupResolverSummary,
  removeGroupResolver,
  saveGroupResolver,
  type GroupResolver,
} from "@/lib/group-resolver";
import { TextField } from "@/components/ui/Controls";

/**
 * A group's own DNS-over-HTTPS endpoint, from the design's member view. What it says and sends
 * is shared with the native app (`src/lib/group-resolver.ts`).
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
  resolver: GroupResolver | null;
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
    if (!canSaveGroupResolver(url)) return;
    void run(
      () =>
        saveGroupResolver(request, groupId, url).then(() => {
          setPasting(false);
          setUrl("");
        }),
      COPY.saveFailed,
    );
  }

  const canSave = !busy && canSaveGroupResolver(url);

  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">
        {COPY.title}
      </h2>
      <div className="px-[18px] py-4">
        {pasting ? (
          <div className="flex flex-col gap-2">
            <TextField
              label={COPY.fieldLabel(groupName)}
              value={url}
              onChange={setUrl}
              placeholder={COPY.placeholder}
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
        ) : dohOverrideUrl ? (
          <>
            <p className="m-0 break-all font-mono text-[13px]">{dohOverrideUrl}</p>
            <p className="mt-1 mb-0 text-[12px]" style={{ color: "var(--ff-ink-3)" }}>
              {COPY.overrideNote(groupName)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPasting(true)}
                className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-accent)" }}
              >
                {COPY.replace}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => removeGroupResolver(request, groupId), COPY.removeFailed)
                }
                className="rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
                style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-danger)" }}
              >
                {COPY.remove}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: "var(--ff-ink-3)" }}>
              {groupResolverSummary(resolver)}
            </p>
            {resolver?.networks.map((network) => (
              <p key={network.id} className="mt-1 mb-0 text-[12px] text-[var(--ff-ink-3)]">
                {groupResolverNetworkLine(network)}
              </p>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setPasting(true)}
              className="mt-2.5 rounded-lg px-3 py-[7px] text-[12.5px] font-semibold"
              style={{ border: "1px solid var(--ff-control-line)", color: "var(--ff-accent)" }}
            >
              {COPY.override}
            </button>
          </>
        )}

        {!pasting ? <p className="mt-2 mb-0 text-[12px] text-[var(--ff-ink-3)]">
          {COPY.hostNote}
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
