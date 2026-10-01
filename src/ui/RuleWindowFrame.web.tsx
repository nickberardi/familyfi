"use client";

import type { ReactNode } from "react";

/** The web's window frame: a `<fieldset>` whose hidden `<legend>` names the window's controls. */
export function RuleWindowFrame({ legend, children }: { legend: string; children: ReactNode; testID?: string }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 rounded-[9px] border border-[var(--ff-hairline-card)] p-3">
      <legend className="sr-only">{legend}</legend>
      {children}
    </fieldset>
  );
}
