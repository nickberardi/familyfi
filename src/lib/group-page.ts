import type { Group } from "./types";

/**
 * The Family and Things pages' heading: the title, and the line under it. On Family it names who
 * is paused and who is in a no-internet window, or says everyone is online.
 */
export function groupPageTitle(kind: Group["kind"]): string {
  return kind === "family" ? "Family" : "Things";
}

export function groupPageSummary(kind: Group["kind"], groups: Pick<Group, "kind" | "name" | "access">[]): string {
  if (kind === "things") return "Device groups that are not a person. House destinations are Things groups.";
  const rows = groups.filter((group) => group.kind === kind);
  const paused = rows.filter((group) => group.access === "paused").map((group) => group.name);
  const offline = rows.filter((group) => group.access === "blocked").map((group) => group.name);
  if (!paused.length && !offline.length) return "Everyone online right now";
  return [paused.length ? `${paused.join(" and ")} paused` : "", offline.length ? `${offline.join(" and ")} in a no-internet window` : ""]
    .filter(Boolean)
    .join(" · ");
}
