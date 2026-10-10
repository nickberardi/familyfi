"use client";

import type { ReactNode } from "react";

import { useUI } from "./UIContext";

/** Content under a heading that opens and closes it, through the platform's `Fold` when it has one. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const ui = useUI();
  if (ui.Fold) return <ui.Fold open={open}>{children}</ui.Fold>;
  return open ? <>{children}</> : null;
}

/** The caret beside a fold's heading: right while folded, down while open. */
export function FoldCaret({ open, size = 15, color }: { open: boolean; size?: number; color: string }) {
  const ui = useUI();
  if (ui.FoldCaret) return <ui.FoldCaret open={open} size={size} color={color} />;
  return <ui.Icon name={open ? "caret-down" : "caret-right"} size={size} color={color} />;
}
