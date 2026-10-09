"use client";

import { BACKUP_COPY as COPY } from "@/lib/backup-copy";
import type { ImportSummary } from "@/lib/types";
import { BackupImport } from "./BackupImport";

/** Settings' Backup card: download the household as an export, or replace it with one. */
export function BackupCard({ onImported }: { onImported: (summary: ImportSummary) => void | Promise<void> }) {
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
              href="/api/v1/settings/export"
              download
              className="inline-block rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
              data-testid="backup-export"
            >
              {COPY.exportLabel}
            </a>
          </div>
        </div>
        <div className="border-t border-[var(--ff-hairline)] pt-4">
          <BackupImport onImported={onImported} />
        </div>
      </div>
    </section>
  );
}
