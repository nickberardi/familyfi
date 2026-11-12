import type { Group } from "./types";

/**
 * The notice a device shows shortly before a timed block it made ends, so the person can give it
 * more time. Each client schedules it locally; nothing is sent from the server.
 */

/** How long before the end the notice shows. */
export const PAUSE_ENDING_LEAD_MS = 5 * 60_000;

export type PauseEndingNotice = {
  /** When to show it, in milliseconds since the epoch. */
  at: number;
  title: string;
  body: string;
};

/** The notice for a block ending at `until`, or null when it ends too soon for one. */
export function pauseEndingNotice(group: Pick<Group, "name">, until: number, now: number): PauseEndingNotice | null {
  const at = until - PAUSE_ENDING_LEAD_MS;
  if (at <= now) return null;
  return {
    at,
    title: `${group.name}’s block ends in 5 minutes`,
    body: "Internet comes back then. Choose More time to keep it blocked.",
  };
}
