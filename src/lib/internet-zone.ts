import { formatClock } from "./display";
import { internetState, type InternetWindow } from "./rule-windows";
import type { Group } from "./types";

/**
 * A group's device-wide controls, kept apart from its category marks: whether all of its
 * internet is on, and the sentence under it naming its scope. A group with no internet rule
 * says so, rather than implying one exists. Every client renders its internet zone from this.
 */
export type InternetZoneTone = "on" | "off" | "paused" | "no_rule";

export type InternetZoneText = { tone: InternetZoneTone; title: string; sub: string };

export function internetZoneText(
  group: Pick<Group, "name" | "deviceCount" | "suspension" | "allowance">,
  windows: InternetWindow[],
  timezone: string,
  now: Date,
): InternetZoneText {
  const state = internetState(group, windows, now, timezone);
  const devices = group.deviceCount === 1 ? "its 1 device" : `all ${group.deviceCount} of its devices`;
  const at = (iso: string | null) => (iso ? formatClock(new Date(iso), timezone) : null);
  const by = (actor: { name: string } | null) => (actor ? ` by ${actor.name}` : "");

  if (state.state === "no_rule") {
    return {
      tone: "no_rule",
      title: "All internet · no rule",
      sub: `Nothing limits ${group.name}’s internet. Category rules still apply on their own.`,
    };
  }
  const off = state.state === "paused" || state.state === "blocked";
  const sub =
    state.state === "paused"
      ? `Paused${state.until ? ` until ${at(state.until)}` : " until you resume"}${by(state.by)}, on ${devices}.`
      : state.state === "blocked"
        ? `${state.window}${state.until ? ` until ${at(state.until)}` : ", always"}, on ${devices}.`
        : state.state === "allowed"
          ? `${state.window ?? "The schedule"} lifted${state.until ? ` until ${at(state.until)}` : ""}${by(state.by)}, on ${devices}.`
          : state.next
            ? `${state.next.window} starts at ${at(state.next.at)}, on ${devices}.`
            : `Online on ${devices}.`;
  return {
    tone: state.state === "paused" ? "paused" : off ? "off" : "on",
    title: off ? "All internet · off" : "All internet · on",
    sub,
  };
}

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
  if (state === "paused") return { word: "Paused", fill: "paused", ink: "ink-on-fill", wordInk: "paused", border: "none" };
  if (state === "blocked") return { word: "Off", fill: "accent", ink: "ink-on-fill", wordInk: "accent", border: "none" };
  if (state === "no_rule") return { word: "No rule", fill: null, ink: "ink-3", wordInk: "ink-2", border: "dashed" };
  return { word: "On", fill: "field", ink: "ink-2", wordInk: "ink-2", border: "none" };
}

/** The group's monogram as its card shows it: its own, else the first two letters of its name. */
export function groupMonogram(group: Pick<Group, "monogram" | "name">): string {
  return (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
}
