import { internetState, type InternetWindow } from "./rule-windows";
import type { Group } from "./types";

/**
 * All internet as one mark in a closed card's row: Off, Paused, On, or No rule when nothing
 * limits it. Colours are `--ff-*` token names; `border: "dashed"` marks the no-rule outline.
 */
export type InternetMarkLook = {
  word: string;
  fill: string | null;
  ink: string;
  wordInk: string;
  border: "none" | "dashed";
};

export function internetMarkLook(
  group: Pick<Group, "suspension" | "allowance">,
  windows: InternetWindow[],
  timezone: string,
  now: Date,
): InternetMarkLook {
  const state = internetState(group, windows, now, timezone).state;
  if (state === "paused") return { word: "Blocked", fill: "paused", ink: "ink-on-fill", wordInk: "paused", border: "none" };
  if (state === "blocked") return { word: "Off", fill: "accent", ink: "ink-on-fill", wordInk: "accent", border: "none" };
  if (state === "no_rule") return { word: "No rule", fill: null, ink: "ink-3", wordInk: "ink-2", border: "dashed" };
  return { word: "On", fill: "field", ink: "ink-2", wordInk: "ink-2", border: "none" };
}

/** The group's monogram as its card shows it: its own, else the first two letters of its name. */
export function groupMonogram(group: Pick<Group, "monogram" | "name">): string {
  return (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
}

/** A person's monogram on a stacked card: their own, else their initial. */
export function personMonogram(group: Pick<Group, "monogram" | "name">): string {
  return (group.monogram ?? group.name.trim().slice(0, 1).toUpperCase()).slice(0, 4);
}
