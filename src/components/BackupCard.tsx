"use client";

import { useState, type MouseEvent } from "react";

import { apiErrorNotice, apiErrorOf, type ErrorNotice } from "@/lib/api-client";
import { BACKUP_COPY as COPY } from "@/lib/backup-copy";
import type { ImportSummary } from "@/lib/types";
import { BackupImport } from "./BackupImport";
import { PRIMARY_BUTTON } from "@/components/ui/buttons";
import { ErrorNote } from "@/ui/ErrorNote";

const EXPORT_URL = "/api/v1/settings/export";

/**
 * Downloads the export through `fetch`, so a refusal (the demo's lock, an expired session) shows its
 * message here instead of saving the error as the file. The link's `href` still works without script.
 */
async function downloadExport(): Promise<ErrorNotice | null> {
  const fallback = "Couldn't export the household. Try again.";
  try {
    const response = await fetch(EXPORT_URL, { credentials: "same-origin" });
    if (!response.ok) return apiErrorNotice(apiErrorOf(await response.json().catch(() => null), response.status), fallback);
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "familyfi-export.tar.gz";
    const url = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return null;
  } catch {
    return { text: fallback };
  }
}

/** Settings' Backup card: download the household as an export, or replace it with one. */
export function BackupCard({ onImported }: { onImported: (summary: ImportSummary) => void | Promise<void> }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<ErrorNotice | null>(null);
  async function exportHousehold(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (exporting) return;
    setExporting(true);
    setError(null);
    setError(await downloadExport());
    setExporting(false);
  }
  return (
    <section
      aria-labelledby="backup-title"
      className="overflow-hidden rounded-xl border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]"
      data-testid="settings-backup"
    >
      <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <h2 id="backup-title" className="text-[14px] font-semibold text-[var(--ff-ink)]">
          {COPY.title}
        </h2>
        <p className="text-[14px] text-[var(--ff-muted)]">{COPY.sub}</p>
      </div>
      <div className="flex flex-col gap-4 px-[18px] py-4">
        <div className="flex flex-col gap-2.5">
          <p className="text-[14px] text-[var(--ff-muted)]">{COPY.exportNote}</p>
          <div>
            <a
              href={EXPORT_URL}
              download
              onClick={exportHousehold}
              aria-disabled={exporting || undefined}
              className={PRIMARY_BUTTON}
              data-testid="backup-export"
            >
              {COPY.exportLabel}
            </a>
          </div>
          {error ? <ErrorNote notice={error} testID="backup-export-error" /> : null}
        </div>
        <div className="border-t border-[var(--ff-hairline)] pt-4">
          <BackupImport onImported={onImported} />
        </div>
      </div>
    </section>
  );
}
