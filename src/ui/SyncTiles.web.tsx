"use client";

import type { ReactNode } from "react";

/** The web's tile grid: equal columns at least 200px wide, so a tile left on a row keeps its column. */
export function SyncTiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
      {children}
    </div>
  );
}
