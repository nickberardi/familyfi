"use client";

import type { ReactNode } from "react";

/** The web's disclosure: `<details>` and `<summary>`, which the browser opens and closes. */
export function Disclosure({ title, children }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <details className="mt-3 rounded-lg border border-[var(--ff-hairline-card)] px-3 py-2 text-[12.5px]">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
