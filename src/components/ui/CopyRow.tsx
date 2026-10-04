"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/** A labelled value in the machine column, with a button that copies it. */
export function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-[14px] font-semibold text-[var(--ff-muted)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <code data-testid={testId} className="min-w-0 flex-1 rounded-lg bg-[var(--ff-field)] px-3 py-2 font-mono text-[14px] break-all">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[var(--ff-line)] px-2.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)]"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Icon name="copy" size={16} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
