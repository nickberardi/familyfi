"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { BACKUP_COPY as COPY, importSummaryLines } from "@/lib/backup-copy";
import type { ImportSummary } from "@/lib/types";

const BUTTON = "rounded-lg px-3.5 py-2 text-[14px] font-semibold disabled:opacity-40";

function upload(file: File, mode: "preview" | "apply") {
  return api<{ summary: ImportSummary }>(`/api/v1/settings/import?mode=${mode}`, {
    method: "POST",
    body: file,
    headers: { "content-type": "application/gzip" },
  });
}

/**
 * Choose an export, see what it holds, then replace the household with it. Settings' Backup card
 * and setup's restore share it; `onImported` reloads whatever the page shows.
 */
export function BackupImport({ onImported }: { onImported: (summary: ImportSummary) => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "applying">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setDone(false);
    setError("");
    setBusy("reading");
    try {
      setPreview((await upload(chosen, "preview")).summary);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : COPY.readFailed);
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  }

  async function apply() {
    if (!file) return;
    setBusy("applying");
    setError("");
    try {
      const { summary } = await upload(file, "apply");
      setPreview(null);
      setFile(null);
      setDone(true);
      await onImported(summary);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : COPY.applyFailed);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col gap-2.5" data-testid="backup-import">
      <p className="text-[14px] text-[var(--ff-muted)]">{COPY.importNote}</p>
      <div>
        <input
          ref={input}
          type="file"
          accept=".tar.gz,.tgz,application/gzip"
          aria-label={COPY.importLabel}
          className="sr-only"
          onChange={(event) => void choose(event.target.files?.[0])}
          data-testid="backup-import-file"
        />
        <button
          type="button"
          disabled={busy !== ""}
          className={`${BUTTON} border border-[var(--ff-line)] text-[var(--ff-ink)]`}
          onClick={() => input.current?.click()}
        >
          {busy === "reading" ? COPY.reading : COPY.choose}
        </button>
      </div>
      {preview ? (
        <div className="rounded-[10px] border border-[var(--ff-line)] p-3.5" role="region" aria-label={COPY.importLabel} data-testid="backup-preview">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] leading-5 text-[var(--ff-ink)]">
            {importSummaryLines(preview).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== ""}
              className={`${BUTTON} bg-[var(--ff-danger)] text-[var(--ff-ink-on-fill)]`}
              onClick={() => void apply()}
              data-testid="backup-apply"
            >
              {busy === "applying" ? COPY.applying : COPY.apply}
            </button>
            <button
              type="button"
              disabled={busy !== ""}
              className={`${BUTTON} border border-[var(--ff-line)] text-[var(--ff-muted)]`}
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              {COPY.cancel}
            </button>
          </div>
        </div>
      ) : null}
      {done ? <p className="text-[14px] text-[var(--ff-ink)]" role="status">{COPY.done}</p> : null}
      {error ? <p className="text-[14px] text-[var(--ff-danger)]" role="alert">{error}</p> : null}
    </div>
  );
}
